/**
 * ============================================================================
 * NETUNO — FIRMWARE ULTRA ROBUSTO DO ESP32 (Multi-WiFi + Anti-Falha + Portal)
 * ============================================================================
 * Dimensionamento Padrão do Aquário: 25 cm (C) x 13 cm (L) x 18 cm (A)
 *
 * Módulos Ativos:
 * 1. Display LCD 16x2 I2C (0x27) & RTC DS3231 (0x68) -> Porta 21 (SDA) e Porta 22 (SCL)
 * 2. Sensor Ultrassônico HC-SR04 -> Porta 5 (TRIG) e Porta 18 (ECHO)
 * 3. Sensor de Temperatura DS18B20 -> Porta 15 (OneWire)
 * 4. Módulo da Bomba de Oxigênio -> Porta 23
 * 5. Motor de Passo do Alimentador (3g por acionamento) -> Portas 12, 13, 14 e 27
 * 6. Multi-WiFi Resiliente + Fila Offline + Portal AP ("NETUNO-SETUP")
 */

#include <WiFi.h>
#include <WiFiMulti.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <RTClib.h>
#include <AccelStepper.h>
#include <time.h>

#define RTC_TZ_OFFSET_HOURS -3 // Fuso horário de Brasília (-03:00)

// ===================== CONFIGURAÇÃO SUPABASE ================================
const char* SUPABASE_URL = "https://bcdwgmhhrptygaarocjy.supabase.co";
const char* SUPABASE_KEY = "sb_publishable_3C-PPYFJNBrzQ1msagDQAQ_1EQm7GUa";

// ===================== PINAGEM DO HARDWARE (ESP32) ==========================
#define PIN_LCD_SDA           21    // Barramento I2C: Display LCD 16x2 (0x27) + Módulo RTC DS3231 (0x68)
#define PIN_LCD_SCL           22    // Barramento I2C: Display LCD 16x2 (0x27) + Módulo RTC DS3231 (0x68)
#define PIN_TRIG              5     // Sensor Ultrassônico HC-SR04 (Trigger)
#define PIN_ECHO              18    // Sensor Ultrassônico HC-SR04 (Echo)
#define PIN_ONEWIRE           15    // Sensor de Temperatura DS18B20 (OneWire)
#define PIN_PUMP_RELAY        23    // Módulo da Bomba de Oxigênio
#define PUMP_RELAY_ACTIVE_LOW false // Troque para true se o seu módulo relé ativar em nível LOW
#define IN1_PIN               12    // Motor de Passo - IN1
#define IN2_PIN               13    // Motor de Passo - IN2
#define IN3_PIN               14    // Motor de Passo - IN3
#define IN4_PIN               27    // Motor de Passo - IN4

// ===================== ALIMENTADOR (12 COMPARTIMENTOS + BARREIRAS - 3g) =====
const int   TOTAL_FEEDER_COMPARTMENTS  = 12;     // 12 compartimentos no carrossel (total: 36g)
const int   GRAMS_PER_DOSE             = 3;      // Gramas por compartimento
const int   MAX_DOSES_PER_FEED         = 12;     // Máximo 36g por acionamento (12 x 3g)
const int   FEEDER_LOW_ALERT_COMPS     = 4;      // Aviso de ração baixa (<= 4 comps = 12g)
const int   FEEDER_CRITICAL_ALERT_COMPS = 2;     // Alerta crítico (<= 2 comps = 6g)

// Calibração validada no alimentador.ino (HALF4WIRE: 4096 passos = 360°)
const long  PASSOS_ALIMENTACAO         = 341;    // 30°   -> Compartimento atual até o próximo
const long  PASSOS_BARREIRA            = 170;    // 14.9° -> Barreira <-> Compartimento (meia etapa)
const float velocidadeMaxPassos        = 1000.0; // Velocidade máx. em passos/seg
const float aceleracaoPassos           = 600.0;  // Rampa de aceleração em passos/seg²
const bool  FEEDER_INVERT_DIR          = false;  // Troque para true se quiser inverter o sentido
const bool  FEEDER_SHAKE_ENABLED       = true;   // Tremidinha ao final da dose para soltar a ração
const long  FEEDER_SHAKE_STEPS         = 40;     // Amplitude calibrada (k 40)
const int   FEEDER_SHAKE_REPS          = 4;      // Quantidade de idas e voltas da tremidinha
const float FEEDER_SHAKE_SPEED         = 1000.0; // Velocidade da tremidinha (passos/s)
const float FEEDER_SHAKE_ACCEL         = 3000.0; // Aceleração alta = tranco seco

// Estado físico atual do carrossel (salvo em Flash NVS; inicia alinhado na BARREIRA e cheio 12/12)
int  feederCompartmentsLeft            = TOTAL_FEEDER_COMPARTMENTS;
bool feederOnBarrier                   = true;   // true = barreira tampando o furo (pronto p/ reabastecer)

// ===================== HORÁRIOS PROGRAMADOS DO ALIMENTADOR (BASEADOS NO RTC) =
#define MAX_FEED_SCHEDULES 8

struct FeedScheduleItem {
  int    hour;
  int    minute;
  String portion;
  bool   enabled;
};

FeedScheduleItem feedSchedules[MAX_FEED_SCHEDULES] = {
  { 8,  0,  "3g", true  },
  { 14, 0,  "3g", true  },
  { 20, 0,  "6g", true  },
  { 0,  0,  "",   false },
  { 0,  0,  "",   false },
  { 0,  0,  "",   false },
  { 0,  0,  "",   false },
  { 0,  0,  "",   false }
};

// Estado atual do Relógio do Módulo RTC
int rtcYear   = 2026;
int rtcMonth  = 11;
int rtcDay    = 23;
int rtcHour   = 8;
int rtcMinute = 0;
int rtcSecond = 0;
int lastFedKey = -1; // Evita alimentar duas vezes no mesmo minuto do RTC
bool rtcOk = false;
bool rtcHardwareValid = false;
bool ntpSynced = false;
unsigned long lastRtcTickMs = 0;
unsigned long lastRtcNtpSyncMs = 0;
const unsigned long RTC_NTP_RESYNC_INTERVAL_MS = 3600000UL; // Ressincroniza DS3231 a cada 1h com a internet

// ===================== REDES WI-FI SALVAS (ATÉ 5 REDES) =====================
#define MAX_SAVED_WIFI  5

struct SavedWifiNetwork {
  String ssid;
  String password;
  bool   enabled;
};

// Lista inicial de redes conhecidas (carregada e mesclada com a memória Flash NVS)
SavedWifiNetwork savedNetworks[MAX_SAVED_WIFI] = {
  { "Iphone de JL",    "12345678", true  }, // Rede 1 (Principal / Hotspot)
  { "Casa_Fibra_2.4G", "",         false }, // Rede 2 (Reserva 1)
  { "Vivo-Fibra-2G",   "",         false }, // Rede 3 (Reserva 2)
  { "",                "",         false }, // Rede 4 (Livre)
  { "",                "",         false }  // Rede 5 (Livre)
};

// ===================== FILA OFFLINE EM RAM (ANTI-PERDA DE DADOS) ============
#define OFFLINE_QUEUE_SIZE 20

struct OfflineReading {
  int   waterPct;
  float distanceCm;
  float tempC;
  unsigned long ageSeconds;
  bool  valid;
};

OfflineReading offlineQueue[OFFLINE_QUEUE_SIZE];
int offlineHead  = 0;
int offlineCount = 0;

// ===================== INSTÂNCIAS DE HARDWARE E REDE ========================
LiquidCrystal_I2C lcd(0x27, 16, 2);
OneWire oneWire(PIN_ONEWIRE);
DallasTemperature tempSensor(&oneWire);
RTC_DS3231 rtc;
AccelStepper mp(AccelStepper::HALF4WIRE, IN1_PIN, IN3_PIN, IN2_PIN, IN4_PIN);
Preferences prefs;
WebServer portalServer(80);
DNSServer dnsServer;
const IPAddress AP_LOCAL_IP(10, 0, 0, 1);
const IPAddress AP_GATEWAY(10, 0, 0, 1);
const IPAddress AP_SUBNET(255, 255, 255, 0);

// ===================== MEDIDAS DO AQUÁRIO (25 x 13 x 18 cm) =================
float tankLengthCm   = 25.0; // Comprimento (cm)
float tankWidthCm    = 13.0; // Largura (cm)
float tankHeightCm   = 18.0; // Altura total (cm)
float sensorOffsetCm = 2.0;  // Margem do sensor até 100%

// ===================== ESTADO ATUAL DOS SENSORES, BOMBA E WI-FI =============
int   waterLevelPct       = 0;
float distanceCm          = 0.0;
float lastValidDistanceCm = 0.0;
float rawDistanceCm       = -1.0;
float waterVolumeL        = 0.0;
float temperatureC        = 26.0;
bool  pumpRelayOn         = true;
String pumpModeRaw        = "cycle|45|15|30";
String pumpModeType       = "cycle"; // "cycle" | "schedule" | "manual"
int    pumpCycleOnMin     = 45;
int    pumpCycleOffMin    = 15;
int    pumpSchedOnMin     = 8 * 60;
int    pumpSchedOffMin    = 22 * 60;
int    pumpSafetyCutoffPct = 30;
unsigned long pumpPhaseStartMs = 0;
int    lastPumpSchedWindow = -1;

enum WifiState {
  WIFI_STATE_DISCONNECTED,
  WIFI_STATE_CONNECTING,
  WIFI_STATE_CONNECTED,
  WIFI_STATE_PORTAL_AP
};

WifiState wifiState         = WIFI_STATE_DISCONNECTED;
String    connectedSsid     = "";
String    deviceUsername    = "";
String    devicePassword    = "";
String    deviceHardwareId  = "";
int       currentNetIndex   = -1;
int       consecutiveFails  = 0;
int       httpFailCount     = 0;
bool      apPortalActive    = false;

unsigned long lastSensorMs        = 0;
unsigned long lastLcdToggleMs     = 0;
unsigned long lastSupabaseMs      = 0;
unsigned long lastSchedulesSyncMs = 0;
unsigned long lastHistoryLogMs    = 0;
unsigned long lastWifiAttemptMs   = 0;
unsigned long connectStartMs      = 0;
unsigned long apPortalStartMs     = 0;
int           lcdScreen           = 0; // 0 = Nível/Temp | 1 = Data/Hora e Próx. | 2 = Ração Restante
bool          schedulesSyncedOnce = false;
bool          feederColsSupported = true; // Fallback automático se colunas novas ainda não existirem no banco

// Persistência do estado do alimentador na memória Flash NVS
void loadFeederStateFromNVS() {
  prefs.begin("netuno_feed", true);
  bool initialized = prefs.getBool("init", false);
  if (initialized) {
    feederCompartmentsLeft = constrain(prefs.getInt("comps", TOTAL_FEEDER_COMPARTMENTS), 0, TOTAL_FEEDER_COMPARTMENTS);
    feederOnBarrier        = prefs.getBool("barrier", true);
  } else {
    // Primeiro boot: assume motor alinhado na barreira e 12/12 compartimentos cheios (36g)
    feederCompartmentsLeft = TOTAL_FEEDER_COMPARTMENTS;
    feederOnBarrier        = true;
  }
  prefs.end();

  if (!initialized) {
    prefs.begin("netuno_feed", false);
    prefs.putBool("init", true);
    prefs.putInt("comps", feederCompartmentsLeft);
    prefs.putBool("barrier", feederOnBarrier);
    prefs.end();
  }

  Serial.printf("[ALIMENTADOR/NVS] Estoque: %d/%d (%dg) | Posicao no furo: %s\n",
                feederCompartmentsLeft,
                TOTAL_FEEDER_COMPARTMENTS,
                feederCompartmentsLeft * GRAMS_PER_DOSE,
                feederOnBarrier ? "BARREIRA (tampado)" : "COMPARTIMENTO");
}

void saveFeederStateToNVS() {
  prefs.begin("netuno_feed", false);
  prefs.putBool("init", true);
  prefs.putInt("comps", feederCompartmentsLeft);
  prefs.putBool("barrier", feederOnBarrier);
  prefs.end();
}

int parsePumpHHMMMinutes(const String& hhmm, int fallbackMin) {
  int colonIdx = hhmm.indexOf(':');
  if (colonIdx <= 0) return fallbackMin;
  int h = constrain(hhmm.substring(0, colonIdx).toInt(), 0, 23);
  int m = constrain(hhmm.substring(colonIdx + 1).toInt(), 0, 59);
  return h * 60 + m;
}

bool isPumpWithinSchedule(int nowTotalMin) {
  if (pumpSchedOnMin == pumpSchedOffMin) return true;
  if (pumpSchedOnMin < pumpSchedOffMin) {
    return (nowTotalMin >= pumpSchedOnMin && nowTotalMin < pumpSchedOffMin);
  }
  return (nowTotalMin >= pumpSchedOnMin || nowTotalMin < pumpSchedOffMin);
}

void savePumpConfigToNVS() {
  prefs.begin("netuno_pump", false);
  prefs.putString("mode_raw", pumpModeRaw);
  prefs.putBool("relay_on", pumpRelayOn);
  prefs.end();
}

void parseAndApplyPumpMode(const String& raw, int fallbackCycleOn, bool fromBoot) {
  String clean = raw;
  clean.trim();
  if (clean.length() == 0) return;

  String nextType = "cycle";
  int nextCycleOn = constrain(fallbackCycleOn > 0 ? fallbackCycleOn : pumpCycleOnMin, 1, 240);
  int nextCycleOff = pumpCycleOffMin;
  int nextSchedOn = pumpSchedOnMin;
  int nextSchedOff = pumpSchedOffMin;
  int nextSafety = pumpSafetyCutoffPct;

  if (clean == "manual") {
    nextType = "manual";
  } else if (clean.startsWith("schedule|")) {
    nextType = "schedule";
    int p1 = clean.indexOf('|');
    int p2 = clean.indexOf('|', p1 + 1);
    int p3 = (p2 > p1) ? clean.indexOf('|', p2 + 1) : -1;
    if (p2 > p1) {
      nextSchedOn = parsePumpHHMMMinutes(clean.substring(p1 + 1, p2), nextSchedOn);
      String endPart = (p3 > p2) ? clean.substring(p2 + 1, p3) : clean.substring(p2 + 1);
      nextSchedOff = parsePumpHHMMMinutes(endPart, nextSchedOff);
      if (p3 > p2) {
        int sVal = clean.substring(p3 + 1).toInt();
        if (sVal >= 10) nextSafety = constrain(sVal, 10, 50);
      }
    }
  } else if (clean.startsWith("cycle|")) {
    nextType = "cycle";
    int p1 = clean.indexOf('|');
    int p2 = clean.indexOf('|', p1 + 1);
    int p3 = (p2 > p1) ? clean.indexOf('|', p2 + 1) : -1;
    if (p2 > p1) {
      int onVal = clean.substring(p1 + 1, p2).toInt();
      String offPart = (p3 > p2) ? clean.substring(p2 + 1, p3) : clean.substring(p2 + 1);
      int offVal = offPart.toInt();
      if (onVal >= 1) nextCycleOn = constrain(onVal, 1, 240);
      if (offVal >= 1) nextCycleOff = constrain(offVal, 1, 240);
      if (p3 > p2) {
        int sVal = clean.substring(p3 + 1).toInt();
        if (sVal >= 10) nextSafety = constrain(sVal, 10, 50);
      }
    }
  } else if (clean == "auto") {
    nextType = "cycle";
    clean = "cycle|" + String(nextCycleOn) + "|" + String(nextCycleOff) + "|" + String(nextSafety);
  }

  bool changed = (clean != pumpModeRaw);
  pumpModeRaw = clean;
  pumpModeType = nextType;
  pumpCycleOnMin = nextCycleOn;
  pumpCycleOffMin = nextCycleOff;
  pumpSchedOnMin = nextSchedOn;
  pumpSchedOffMin = nextSchedOff;
  pumpSafetyCutoffPct = nextSafety;

  if (!fromBoot && changed) {
    pumpPhaseStartMs = millis();
    lastPumpSchedWindow = -1;
    savePumpConfigToNVS();
    Serial.printf("[BOMBA] Config atualizada: %s (ON=%dm OFF=%dm, Sched=%02d:%02d-%02d:%02d, Corte<%d%%)\n",
                  pumpModeRaw.c_str(), pumpCycleOnMin, pumpCycleOffMin,
                  pumpSchedOnMin / 60, pumpSchedOnMin % 60,
                  pumpSchedOffMin / 60, pumpSchedOffMin % 60,
                  pumpSafetyCutoffPct);
  }
}

void loadPumpConfigFromNVS() {
  prefs.begin("netuno_pump", true);
  String savedRaw = prefs.getString("mode_raw", "cycle|45|15|30");
  pumpRelayOn = prefs.getBool("relay_on", true);
  prefs.end();

  parseAndApplyPumpMode(savedRaw, 45, true);
  pumpPhaseStartMs = millis();
  lastPumpSchedWindow = -1;
}

// ============================================================================
// 1. PERSISTÊNCIA NA MEMÓRIA FLASH (NVS) — SALVA ATÉ 5 REDES WI-FI
// ============================================================================
void loadSavedNetworksFromNVS() {
  prefs.begin("netuno_wifi", true);
  for (int i = 0; i < MAX_SAVED_WIFI; i++) {
    String keySsid = "ssid_" + String(i);
    String keyPass = "pass_" + String(i);
    String storedSsid = prefs.getString(keySsid.c_str(), "");
    String storedPass = prefs.getString(keyPass.c_str(), "");

    if (storedSsid.length() > 0) {
      savedNetworks[i].ssid     = storedSsid;
      savedNetworks[i].password = storedPass;
      savedNetworks[i].enabled  = true;
    }
  }
  deviceUsername = prefs.getString("dev_user", "");
  devicePassword = prefs.getString("dev_pass", "");
  prefs.end();

  deviceHardwareId = WiFi.macAddress();
  Serial.printf("\n[NVS] ESP32 ID: %s | Usuario cadastrado: \"%s\"\n",
                deviceHardwareId.c_str(),
                deviceUsername.length() > 0 ? deviceUsername.c_str() : "(Nao configurado)");

  Serial.println("\n[NVS] Redes Wi-Fi cadastradas na memória do ESP32:");
  for (int i = 0; i < MAX_SAVED_WIFI; i++) {
    if (savedNetworks[i].enabled && savedNetworks[i].ssid.length() > 0) {
      Serial.printf("  Slot %d: \"%s\"\n", i + 1, savedNetworks[i].ssid.c_str());
    }
  }
}

void saveNetworkToNVS(int slot, const String& ssid, const String& password) {
  if (slot < 0 || slot >= MAX_SAVED_WIFI) return;
  String cleanSsid = ssid;
  cleanSsid.trim();

  savedNetworks[slot].ssid     = cleanSsid;
  savedNetworks[slot].password = password;
  savedNetworks[slot].enabled  = (cleanSsid.length() > 0);

  prefs.begin("netuno_wifi", false);
  String keySsid = "ssid_" + String(slot);
  String keyPass = "pass_" + String(slot);
  prefs.putString(keySsid.c_str(), savedNetworks[slot].ssid);
  prefs.putString(keyPass.c_str(), savedNetworks[slot].password);
  prefs.end();

  Serial.printf("[NVS] Rede salva no Slot %d: \"%s\"\n", slot + 1, cleanSsid.c_str());
}

void saveDeviceCredentialsToNVS(const String& user, const String& pass) {
  String cleanUser = user;
  cleanUser.trim();
  String cleanPass = pass;
  cleanPass.trim();

  if (cleanUser.length() == 0) return;

  deviceUsername = cleanUser;
  devicePassword = cleanPass;

  prefs.begin("netuno_wifi", false);
  prefs.putString("dev_user", deviceUsername);
  prefs.putString("dev_pass", devicePassword);
  prefs.end();

  Serial.printf("[NVS] Credenciais do ESP32 salvas! Usuario: \"%s\"\n", deviceUsername.c_str());
}

// Adiciona ou atualiza uma rede na lista de redes salvas (sem duplicar SSID)
void addOrUpdateWifiNetwork(const String& ssid, const String& password) {
  String cleanSsid = ssid;
  cleanSsid.trim();
  if (cleanSsid.length() == 0) return;

  // 1. Verifica se já existe esse SSID para apenas atualizar a senha
  for (int i = 0; i < MAX_SAVED_WIFI; i++) {
    if (savedNetworks[i].ssid.equalsIgnoreCase(cleanSsid)) {
      saveNetworkToNVS(i, cleanSsid, password);
      return;
    }
  }

  // 2. Procura o primeiro slot livre
  for (int i = 0; i < MAX_SAVED_WIFI; i++) {
    if (!savedNetworks[i].enabled || savedNetworks[i].ssid.length() == 0) {
      saveNetworkToNVS(i, cleanSsid, password);
      return;
    }
  }

  // 3. Se todos os 5 slots estiverem ocupados, substitui o último (Slot 5)
  saveNetworkToNVS(MAX_SAVED_WIFI - 1, cleanSsid, password);
}

// ============================================================================
// 2. EVENTOS ASSÍNCRONOS DO HARDWARE WI-FI (AUTO-RECUPERAÇÃO)
// ============================================================================
void onWiFiEvent(WiFiEvent_t event) {
  switch (event) {
    case ARDUINO_EVENT_WIFI_STA_GOT_IP:
      wifiState        = WIFI_STATE_CONNECTED;
      connectedSsid    = WiFi.SSID();
      consecutiveFails = 0;
      httpFailCount    = 0;
      configTime(RTC_TZ_OFFSET_HOURS * 3600, 0, "a.st1.ntp.br", "b.st1.ntp.br", "pool.ntp.org");
      Serial.printf("[WIFI-EVENT] Conectado a \"%s\" | IP: %s | RSSI: %d dBm\n",
                    connectedSsid.c_str(),
                    WiFi.localIP().toString().c_str(),
                    WiFi.RSSI());
      break;

    case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
      if (wifiState == WIFI_STATE_CONNECTED) {
        Serial.println("[WIFI-EVENT] Queda de sinal detectada! Preparando reconexão automática...");
      }
      if (!apPortalActive) {
        wifiState = WIFI_STATE_DISCONNECTED;
      }
      connectedSsid = "";
      break;

    default:
      break;
  }
}

// ============================================================================
// 3. PORTAL DE CONFIGURAÇÃO LOCAL (AP "NETUNO-SETUP" -> 10.0.0.1)
//    Permite cadastrar múltiplas redes Wi-Fi direto pelo celular/PC
// ============================================================================
// Escapa caracteres especiais para evitar quebra/injeção HTML no Portal AP
String htmlEscape(const String& str) {
  String out = "";
  out.reserve(str.length());
  for (size_t i = 0; i < str.length(); i++) {
    char c = str.charAt(i);
    if (c == '&') out += "&amp;";
    else if (c == '<') out += "&lt;";
    else if (c == '>') out += "&gt;";
    else if (c == '"') out += "&quot;";
    else if (c == '\'') out += "&#39;";
    else out += c;
  }
  return out;
}

void handlePortalRoot() {
  String safeUser = htmlEscape(deviceUsername);
  String safeSsid = htmlEscape(savedNetworks[0].enabled ? savedNetworks[0].ssid : String(""));
  String devPassPh = devicePassword.length() > 0 ? "Deixe em branco para manter a atual" : "Crie uma senha de acesso";
  String wifiPassPh = (savedNetworks[0].enabled && savedNetworks[0].password.length() > 0)
                        ? "Deixe em branco para manter a atual"
                        : "Senha da rede Wi-Fi";

  String html = "<!DOCTYPE html><html><head><meta charset='utf-8'>";
  html += "<meta name='viewport' content='width=device-width,initial-scale=1'>";
  html += "<title>Netuno - Configurar ESP32</title>";
  html += "<style>body{font-family:sans-serif;background:#031117;color:#fff;padding:18px;margin:0}";
  html += ".card{max-width:460px;margin:0 auto;background:#07212D;border:1px solid #10C3E3;border-radius:16px;padding:20px}";
  html += "h2{margin-top:0;color:#47DDF5}h4{margin:16px 0 8px;color:#67E8F9;border-bottom:1px solid #0E7490;padding-bottom:4px}";
  html += "label{display:block;font-size:12px;color:#CFFAFE;margin:10px 0 4px}";
  html += "input{width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #0E9EB8;background:#031117;color:#fff}";
  html += "button{width:100%;margin-top:18px;padding:12px;border:0;border-radius:10px;background:#10C3E3;color:#031117;font-weight:bold;cursor:pointer;font-size:14px}";
  html += ".net{font-size:12px;padding:6px 10px;background:#031117;border-radius:8px;margin-bottom:6px;border:1px solid #0E7490}</style></head><body>";
  html += "<div class='card'><h2>Netuno • Setup Inicial do ESP32</h2>";
  html += "<p style='font-size:12px;color:#A5F3FC;margin-top:4px'>ID Físico (MAC): <strong>" + WiFi.macAddress() + "</strong></p>";

  html += "<form method='POST' action='/save'>";
  html += "<h4>1. Cadastrar Acesso deste ESP32 no Site</h4>";
  html += "<p style='font-size:12px;color:#A5F3FC;margin:4px 0 8px'>Defina o Usuário e Senha que você usará no site para acessar este ESP32 em específico:</p>";
  html += "<label>Usuário do ESP32 (Acesso no Site):</label>";
  html += "<input name='dev_user' value='" + safeUser + "' placeholder='Ex: aquario_joao' required>";
  html += "<label>Senha do ESP32 (Acesso no Site):</label>";
  html += "<input name='dev_pass' type='password' value='' placeholder='" + devPassPh + "'";
  if (devicePassword.length() == 0) html += " required";
  html += ">";

  html += "<h4>2. Configurar Rede Wi-Fi (2.4 GHz)</h4>";
  html += "<label>Nome do Wi-Fi (SSID):</label>";
  html += "<input name='ssid' value='" + safeSsid + "' placeholder='Ex: Iphone de JL' required>";
  html += "<label>Senha do Wi-Fi:</label>";
  html += "<input name='pass' type='password' value='' placeholder='" + wifiPassPh + "'>";

  html += "<button type='submit'>Salvar Usuário, Senha e Wi-Fi</button>";
  html += "</form>";

  html += "<h4>Redes Wi-Fi Salvas na Memória:</h4>";
  for (int i = 0; i < MAX_SAVED_WIFI; i++) {
    html += "<div class='net'><strong>Rede " + String(i + 1) + ":</strong> ";
    html += (savedNetworks[i].enabled && savedNetworks[i].ssid.length() > 0)
              ? htmlEscape(savedNetworks[i].ssid)
              : "<em>(Vazio)</em>";
    html += "</div>";
  }
  html += "</div></body></html>";

  portalServer.send(200, "text/html", html);
}

void handlePortalSave() {
  String devUser = portalServer.arg("dev_user");
  String devPass = portalServer.arg("dev_pass");
  String newSsid = portalServer.arg("ssid");
  String newPass = portalServer.arg("pass");

  if (devPass.length() == 0 && devicePassword.length() > 0) {
    devPass = devicePassword;
  }

  if (newSsid.length() > 0 && newPass.length() == 0) {
    String cleanSsid = newSsid;
    cleanSsid.trim();
    for (int i = 0; i < MAX_SAVED_WIFI; i++) {
      if (savedNetworks[i].ssid.equalsIgnoreCase(cleanSsid) && savedNetworks[i].password.length() > 0) {
        newPass = savedNetworks[i].password;
        break;
      }
    }
  }

  if (devUser.length() > 0) {
    saveDeviceCredentialsToNVS(devUser, devPass);
  }
  if (newSsid.length() > 0) {
    addOrUpdateWifiNetwork(newSsid, newPass);
  }

  portalServer.send(
    200,
    "text/html",
    "<html><body style='background:#031117;color:#47DDF5;font-family:sans-serif;text-align:center;padding:40px'>"
    "<h2>Configuracao Salva com Sucesso!</h2>"
    "<p style='color:#CFFAFE'>Usuario vinculado a este ESP32: <strong>" + htmlEscape(deviceUsername) + "</strong></p>"
    "<p>Use este mesmo usuario e senha para acessar seu aquario no site Netuno.</p>"
    "<p>Conectando ao Wi-Fi...</p></body></html>"
  );

  delay(1000);
  apPortalActive = false;
  dnsServer.stop();
  portalServer.stop();
  WiFi.softAPdisconnect(true);
  wifiState = WIFI_STATE_DISCONNECTED;
  consecutiveFails = 0;
}

void startConfigPortalAP() {
  if (apPortalActive) return;

  Serial.println("\n[PORTAL AP] Iniciando Ponto de Acesso \"NETUNO-SETUP\" (IP facil: 10.0.0.1)...");
  WiFi.disconnect(true);
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAPConfig(AP_LOCAL_IP, AP_GATEWAY, AP_SUBNET);
  WiFi.softAP("NETUNO-SETUP");

  // DNS Captive Portal: abre a tela de setup automaticamente no celular ou por qualquer endereco
  dnsServer.start(53, "*", AP_LOCAL_IP);

  portalServer.on("/", HTTP_GET, handlePortalRoot);
  portalServer.on("/save", HTTP_POST, handlePortalSave);
  portalServer.onNotFound(handlePortalRoot);
  portalServer.begin();

  apPortalActive  = true;
  apPortalStartMs = millis();
  wifiState       = WIFI_STATE_PORTAL_AP;

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("AP: NETUNO-SETUP");
  lcd.setCursor(0, 1);
  lcd.print("IP: 10.0.0.1    ");
}

// ============================================================================
// 4. GERENCIADOR MULTI-WIFI INTELIGENTE (ESCOLHE O MELHOR SINAL 2.4GHz)
// ============================================================================
void startBestWifiConnection() {
  if (apPortalActive) return;

  // Se o ESP32 ainda não possui Usuário e Senha cadastrados na memória,
  // abre automaticamente a rede NETUNO-SETUP (10.0.0.1) para o cadastro inicial!
  if (deviceUsername.length() == 0) {
    Serial.println("[SETUP INICIAL] Nenhum usuario/senha cadastrado neste ESP32. Abrindo Portal AP...");
    startConfigPortalAP();
    return;
  }

  WiFi.mode(WIFI_STA);
  // Ajustes de estabilidade elétrica e compatibilidade com roteadores e iPhone/Android:
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  WiFi.setTxPower(WIFI_POWER_15dBm);       // Evita pico de corrente (brownout) na USB
  WiFi.setMinSecurity(WIFI_AUTH_WPA_PSK);  // Compatível com WPA/WPA2/WPA3 misto

  Serial.println("\n[MULTI-WIFI] Escaneando redes 2.4GHz próximas...");
  int n = WiFi.scanNetworks(false, false, false, 250); // Scan rápido (250ms por canal)

  int    bestSlot      = -1;
  int    bestRssi      = -1000;
  String matchedScanSsid = "";

  for (int i = 0; i < n; i++) {
    String foundSsid = WiFi.SSID(i);
    int    foundRssi = WiFi.RSSI(i);

    for (int slot = 0; slot < MAX_SAVED_WIFI; slot++) {
      if (!savedNetworks[slot].enabled || savedNetworks[slot].ssid.length() == 0) continue;

      String savedLower = savedNetworks[slot].ssid;
      String foundLower = foundSsid;
      savedLower.toLowerCase();
      foundLower.toLowerCase();

      // Aceita correspondência exata ou variação de apóstrofo do iPhone (ex: "Iphone de JL")
      bool isMatch = (foundLower == savedLower) ||
                     (savedLower.indexOf("iphone") >= 0 && foundLower.indexOf("iphone") >= 0 && foundLower.indexOf("jl") >= 0);

      if (isMatch && foundRssi > bestRssi) {
        bestRssi        = foundRssi;
        bestSlot        = slot;
        matchedScanSsid = foundSsid;
      }
    }
  }
  WiFi.scanDelete();

  // Se nenhuma rede salva apareceu no scan (ex: SSID oculto ou hotspot acordando),
  // tenta em rodízio (Round-Robin) as redes salvas habilitadas
  if (bestSlot == -1) {
    for (int step = 1; step <= MAX_SAVED_WIFI; step++) {
      int candidate = (currentNetIndex + step) % MAX_SAVED_WIFI;
      if (savedNetworks[candidate].enabled && savedNetworks[candidate].ssid.length() > 0) {
        bestSlot        = candidate;
        matchedScanSsid = savedNetworks[candidate].ssid;
        break;
      }
    }
  }

  if (bestSlot == -1) {
    // Nenhuma rede cadastrada: abre imediatamente o portal de configuração
    startConfigPortalAP();
    return;
  }

  currentNetIndex  = bestSlot;
  wifiState        = WIFI_STATE_CONNECTING;
  connectStartMs   = millis();
  lastWifiAttemptMs = millis();

  Serial.printf("[MULTI-WIFI] Tentando conectar na Rede #%d: \"%s\" (Sinal: %d dBm)\n",
                bestSlot + 1,
                matchedScanSsid.c_str(),
                bestRssi > -900 ? bestRssi : 0);

  WiFi.disconnect(false);
  WiFi.begin(matchedScanSsid.c_str(), savedNetworks[bestSlot].password.c_str());
}

// ============================================================================
// 5. WATCHDOG DE CONECTIVIDADE (CHAMADO NO LOOP SEM TRAVAR OS SENSORES)
// ============================================================================
void maintainWiFiConnection() {
  unsigned long now = millis();

  // Se o Portal AP estiver aberto, processa clientes HTTP/DNS e tenta reconectar às redes salvas a cada 3 min
  if (apPortalActive) {
    dnsServer.processNextRequest();
    portalServer.handleClient();
    if (now - apPortalStartMs >= 180000) {
      Serial.println("[PORTAL AP] Tempo de portal concluído. Retomando busca por redes salvas...");
      apPortalActive = false;
      dnsServer.stop();
      portalServer.stop();
      WiFi.softAPdisconnect(true);
      wifiState = WIFI_STATE_DISCONNECTED;
      consecutiveFails = 0;
    }
    return;
  }

  // Se já estiver conectado
  if (WiFi.status() == WL_CONNECTED) {
    wifiState = WIFI_STATE_CONNECTED;

    // Se ocorrerem muitas falhas HTTP seguidas (ex: roteador sem internet / conexão zumbi),
    // força renovação do Wi-Fi para buscar outra rede com internet ativa
    if (httpFailCount >= 5) {
      Serial.println("[WATCHDOG] 5 falhas HTTP seguidas (conexão sem internet). Trocando/renovando Wi-Fi...");
      httpFailCount = 0;
      WiFi.disconnect(true);
      wifiState = WIFI_STATE_DISCONNECTED;
    }
    return;
  }

  // Se estava tentando conectar e passou de 12 segundos sem resposta
  if (wifiState == WIFI_STATE_CONNECTING) {
    if (now - connectStartMs >= 12000) {
      consecutiveFails++;
      Serial.printf("[MULTI-WIFI] Timeout ao conectar (Falha #%d).\n", consecutiveFails);
      wifiState = WIFI_STATE_DISCONNECTED;

      // Após 6 tentativas frustradas em todas as redes, abre o Portal AP por 3 minutos
      // para caso o usuário queira cadastrar um novo Wi-Fi
      if (consecutiveFails >= 6) {
        startConfigPortalAP();
        return;
      }
    }
    return;
  }

  // Se estiver desconectado, faz nova tentativa com intervalo progressivo (Backoff: 8s -> 15s)
  unsigned long retryInterval = (consecutiveFails < 2) ? 8000 : 15000;
  if (now - lastWifiAttemptMs >= retryInterval || lastWifiAttemptMs == 0) {
    startBestWifiConnection();
  }
}

// ============================================================================
// 6. FILA OFFLINE — GUARDA LEITURAS QUANDO O WI-FI CAI E ENVIA DEPOIS
// ============================================================================
void enqueueOfflineReading() {
  int idx = (offlineHead + offlineCount) % OFFLINE_QUEUE_SIZE;
  if (offlineCount == OFFLINE_QUEUE_SIZE) {
    // Fila cheia: sobrescreve o registro mais antigo
    offlineHead = (offlineHead + 1) % OFFLINE_QUEUE_SIZE;
  } else {
    offlineCount++;
  }

  offlineQueue[idx].waterPct   = waterLevelPct;
  offlineQueue[idx].distanceCm = distanceCm;
  offlineQueue[idx].tempC      = temperatureC;
  offlineQueue[idx].ageSeconds = millis() / 1000;
  offlineQueue[idx].valid      = true;

  Serial.printf("[FILA OFFLINE] Leitura armazenada em memória (%d/%d pendentes).\n",
                offlineCount, OFFLINE_QUEUE_SIZE);
}

// Escapa strings para montagem segura de payloads JSON
String jsonEscape(const String& str) {
  String out = "";
  out.reserve(str.length());
  for (size_t i = 0; i < str.length(); i++) {
    char c = str.charAt(i);
    if (c == '\\') out += "\\\\";
    else if (c == '"') out += "\\\"";
    else if (c == '\n') out += "\\n";
    else if (c == '\r') out += "\\r";
    else if (c == '\t') out += "\\t";
    else out += c;
  }
  return out;
}

void flushOfflineQueueToSupabase() {
  if (WiFi.status() != WL_CONNECTED || offlineCount == 0) return;

  OfflineReading item = offlineQueue[offlineHead];
  if (!item.valid) {
    offlineHead = (offlineHead + 1) % OFFLINE_QUEUE_SIZE;
    offlineCount--;
    return;
  }

  HTTPClient http;
  http.setTimeout(4000);
  String endpoint = String(SUPABASE_URL) + "/rest/v1/telemetry_logs";
  http.begin(endpoint);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);

  String activeUser = deviceUsername.length() > 0 ? deviceUsername : String("admin");
  String message = "[Recuperado Offline] Água: " + String(item.waterPct) + "% • Temp: " + String(item.tempC, 1) + " °C";
  String payload = "{\"device_username\":\"" + jsonEscape(activeUser) + "\","
                   "\"event_type\":\"sync\","
                   "\"water_level_pct\":" + String(item.waterPct) + ","
                   "\"distance_cm\":" + String(item.distanceCm, 1) + ","
                   "\"temperature_c\":" + String(item.tempC, 1) + ","
                   "\"message\":\"" + jsonEscape(message) + "\","
                   "\"source\":\"Fila Offline ESP32\"}";

  int code = http.POST(payload);
  http.end();

  if (code >= 200 && code < 300) {
    offlineQueue[offlineHead].valid = false;
    offlineHead = (offlineHead + 1) % OFFLINE_QUEUE_SIZE;
    offlineCount--;
    Serial.printf("[FILA OFFLINE] 1 registro sincronizado! Restam %d na fila.\n", offlineCount);
  }
}

// ============================================================================
// 7. LEITURA DOS SENSORES (FILTRO MEDIANA 7 AMOSTRAS), BOMBA E DISPLAY LCD
// ============================================================================
void applyPumpRelay(bool on) {
  pumpRelayOn = on;
  uint8_t level = PUMP_RELAY_ACTIVE_LOW ? (on ? LOW : HIGH) : (on ? HIGH : LOW);
  digitalWrite(PIN_PUMP_RELAY, level);
}

void patchPumpRelayToSupabase() {
  if (WiFi.status() != WL_CONNECTED) return;

  String activeUser = deviceUsername.length() > 0 ? deviceUsername : String("admin");
  activeUser.trim();
  String filterEndpoint = String(SUPABASE_URL) + "/rest/v1/aquarium_status?device_username=eq." + urlEncodeValue(activeUser);

  HTTPClient http;
  http.setTimeout(3000);
  http.begin(filterEndpoint);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
  http.PATCH(String("{\"pump_relay_on\":") + (pumpRelayOn ? "true" : "false") + "}");
  http.end();
}

void checkPumpAutomation() {
  unsigned long nowMs = millis();

  // Proteção contra trabalho a seco quando o sensor ultrassônico tem leitura válida abaixo do corte
  if (rawDistanceCm > 0.0f && waterLevelPct < pumpSafetyCutoffPct && pumpRelayOn) {
    applyPumpRelay(false);
    pumpPhaseStartMs = nowMs;
    savePumpConfigToNVS();
    patchPumpRelayToSupabase();
    Serial.printf("[BOMBA] Corte de seguranca: nivel %d%% < %d%% -> Bomba DESLIGADA.\n",
                  waterLevelPct, pumpSafetyCutoffPct);
    return;
  }

  if (pumpModeType == "cycle") {
    unsigned long targetMs = (unsigned long)(pumpRelayOn ? pumpCycleOnMin : pumpCycleOffMin) * 60000UL;
    if (nowMs - pumpPhaseStartMs >= targetMs) {
      bool nextOn = !pumpRelayOn;
      // Não liga automaticamente se o nível estiver abaixo do corte de segurança
      if (nextOn && rawDistanceCm > 0.0f && waterLevelPct < pumpSafetyCutoffPct) {
        pumpPhaseStartMs = nowMs;
        return;
      }
      applyPumpRelay(nextOn);
      pumpPhaseStartMs = nowMs;
      savePumpConfigToNVS();
      patchPumpRelayToSupabase();
      Serial.printf("[BOMBA/CICLO] Alternou automaticamente para %s.\n", nextOn ? "LIGADA" : "DESLIGADA");
    }
  } else if (pumpModeType == "schedule") {
    int nowTotalMin = rtcHour * 60 + rtcMinute;
    int curWindow = isPumpWithinSchedule(nowTotalMin) ? 1 : 0;
    if (lastPumpSchedWindow != curWindow) {
      lastPumpSchedWindow = curWindow;
      bool targetOn = (curWindow == 1);
      if (targetOn && rawDistanceCm > 0.0f && waterLevelPct < pumpSafetyCutoffPct) {
        targetOn = false;
      }
      if (pumpRelayOn != targetOn) {
        applyPumpRelay(targetOn);
        pumpPhaseStartMs = nowMs;
        savePumpConfigToNVS();
        patchPumpRelayToSupabase();
        Serial.printf("[BOMBA/HORARIO] %02d:%02d -> Bomba %s conforme programacao (%02d:%02d-%02d:%02d).\n",
                      rtcHour, rtcMinute, targetOn ? "LIGADA" : "DESLIGADA",
                      pumpSchedOnMin / 60, pumpSchedOnMin % 60,
                      pumpSchedOffMin / 60, pumpSchedOffMin % 60);
      }
    }
  }
}

float lerDistanciaUnica() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);

  long duracao = pulseIn(PIN_ECHO, HIGH, 30000);
  if (duracao == 0) return -1.0f;

  float dist = (duracao * 0.034f) / 2.0f;
  if (dist < 2.0f || dist > 400.0f) return -1.0f;
  return dist;
}

void readWaterLevel() {
  const int AMOSTRAS = 7;
  float leituras[AMOSTRAS];
  int validas = 0;

  for (int i = 0; i < AMOSTRAS; i++) {
    float d = lerDistanciaUnica();
    if (d > 0.0f) {
      leituras[validas++] = d;
    }
    delay(12);
  }

  if (validas == 0) {
    rawDistanceCm = -1.0f;
    return;
  }

  for (int i = 0; i < validas - 1; i++) {
    for (int j = i + 1; j < validas; j++) {
      if (leituras[i] > leituras[j]) {
        float tmp   = leituras[i];
        leituras[i] = leituras[j];
        leituras[j] = tmp;
      }
    }
  }

  float mediana = leituras[validas / 2];
  if (fabs(mediana - lastValidDistanceCm) > 0.8f || lastValidDistanceCm == 0.0f) {
    lastValidDistanceCm = mediana;
  }

  rawDistanceCm = lastValidDistanceCm;
  distanceCm    = constrain(lastValidDistanceCm, 0.5f, tankHeightCm);

  float maxColumn   = max(1.0f, tankHeightCm - sensorOffsetCm);
  float waterColumn = constrain(tankHeightCm - distanceCm, 0.0f, maxColumn);

  int pct       = round((waterColumn / maxColumn) * 100.0f);
  waterLevelPct = constrain(pct, 0, 100);
  waterVolumeL  = (tankLengthCm * tankWidthCm * waterColumn) / 1000.0f;
}

void readTemperature() {
  tempSensor.requestTemperatures();
  float t = tempSensor.getTempCByIndex(0);

  if (t != DEVICE_DISCONNECTED_C && t > -40.0f && t < 85.0f) {
    temperatureC = t;
  }
}

int parsePortionGrams(const String& portionLabel) {
  String digits = "";
  for (size_t i = 0; i < portionLabel.length(); i++) {
    char c = portionLabel.charAt(i);
    if (isdigit((unsigned char)c)) {
      digits += c;
    } else if (digits.length() > 0) {
      break;
    }
  }
  int rawGrams = (digits.length() > 0) ? digits.toInt() : GRAMS_PER_DOSE;
  int doses = (rawGrams + (GRAMS_PER_DOSE / 2)) / GRAMS_PER_DOSE;
  doses = constrain(doses, 1, MAX_DOSES_PER_FEED);
  return doses * GRAMS_PER_DOSE;
}

int findNextScheduleIndex() {
  int nowMinutes = rtcHour * 60 + rtcMinute;
  int bestAfterIdx = -1;
  int bestAfterMin = 24 * 60 + 1;
  int earliestIdx  = -1;
  int earliestMin  = 24 * 60 + 1;

  for (int i = 0; i < MAX_FEED_SCHEDULES; i++) {
    if (!feedSchedules[i].enabled) continue;
    int schedMin = feedSchedules[i].hour * 60 + feedSchedules[i].minute;
    if (schedMin > nowMinutes && schedMin < bestAfterMin) {
      bestAfterMin = schedMin;
      bestAfterIdx = i;
    }
    if (schedMin < earliestMin) {
      earliestMin = schedMin;
      earliestIdx = i;
    }
  }
  return (bestAfterIdx >= 0) ? bestAfterIdx : earliestIdx;
}

void updateLCD() {
  if (apPortalActive) return; // Mantém mensagem do Portal AP visível quando ativo

  char line0[17];
  char line1[17];

  if (lcdScreen == 0) {
    snprintf(line0, sizeof(line0), "Nivel Agua: %3d%%", waterLevelPct);
    snprintf(line1, sizeof(line1), "Temp: %5.1f %cC  ", temperatureC, (char)223);
  } else if (lcdScreen == 1) {
    snprintf(line0, sizeof(line0), "%02d/%02d  %02d:%02d:%02d ",
             rtcDay, rtcMonth, rtcHour, rtcMinute, rtcSecond);
    int nextIdx = findNextScheduleIndex();
    if (nextIdx >= 0) {
      int nextGrams = parsePortionGrams(feedSchedules[nextIdx].portion);
      snprintf(line1, sizeof(line1), "Prox: %02d:%02d %2dg ",
               feedSchedules[nextIdx].hour, feedSchedules[nextIdx].minute, nextGrams);
    } else {
      snprintf(line1, sizeof(line1), "Prox: --:--     ");
    }
  } else {
    int gramsLeft = feederCompartmentsLeft * GRAMS_PER_DOSE;
    snprintf(line0, sizeof(line0), "Racao:%2dg %2d/12 ", gramsLeft, feederCompartmentsLeft);
    if (feederCompartmentsLeft <= 0) {
      snprintf(line1, sizeof(line1), feederOnBarrier ? "Barreira: Reab. " : "VAZIO! Reabast. ");
    } else if (feederCompartmentsLeft <= FEEDER_CRITICAL_ALERT_COMPS) {
      snprintf(line1, sizeof(line1), "CRITICO! Pouca  ");
    } else if (feederCompartmentsLeft <= FEEDER_LOW_ALERT_COMPS) {
      snprintf(line1, sizeof(line1), "AVISO: Racao Bx ");
    } else if (feederOnBarrier) {
      snprintf(line1, sizeof(line1), "Barreira: OK    ");
    } else {
      snprintf(line1, sizeof(line1), "Estoque: OK     ");
    }
  }

  lcd.setCursor(0, 0);
  lcd.print(line0);
  lcd.setCursor(0, 1);
  lcd.print(line1);
}

// ============================================================================
// 8. MÓDULO RTC DS3231 (RTClib + NTP) + ALIMENTADOR (MOTOR DE PASSO 3g/3g)
// ============================================================================
int daysInMonth(int y, int mo) {
  static const int mdays[12] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
  if (mo == 2 && ((y % 4 == 0 && y % 100 != 0) || (y % 400 == 0))) return 29;
  if (mo < 1 || mo > 12) return 30;
  return mdays[mo - 1];
}

void shiftDateTimeHours(int& y, int& mo, int& d, int& h, int deltaHours) {
  h += deltaHours;
  while (h < 0) {
    h += 24;
    d--;
    if (d < 1) {
      mo--;
      if (mo < 1) {
        mo = 12;
        y--;
      }
      d = daysInMonth(y, mo);
    }
  }
  while (h >= 24) {
    h -= 24;
    d++;
    int maxD = daysInMonth(y, mo);
    if (d > maxD) {
      d = 1;
      mo++;
      if (mo > 12) {
        mo = 1;
        y++;
      }
    }
  }
}

// Prioridade 1: Horário da internet (NTP -03:00), mantendo o RTC DS3231 sempre sincronizado.
// Prioridade 2: RTC DS3231 físico como backup offline quando estiver sem internet.
// Prioridade 3: Fallback via millis() caso não haja internet nem módulo RTC.
void readRtcModule() {
  struct tm timeinfo;
  if (WiFi.status() == WL_CONNECTED && getLocalTime(&timeinfo, 0) && (timeinfo.tm_year + 1900) >= 2025) {
    rtcYear   = timeinfo.tm_year + 1900;
    rtcMonth  = timeinfo.tm_mon + 1;
    rtcDay    = timeinfo.tm_mday;
    rtcHour   = timeinfo.tm_hour;
    rtcMinute = timeinfo.tm_min;
    rtcSecond = timeinfo.tm_sec;
    lastRtcTickMs = millis();

    if (rtcOk) {
      rtcHardwareValid = true;
      DateTime ntpDt(rtcYear, rtcMonth, rtcDay, rtcHour, rtcMinute, rtcSecond);
      DateTime hwDt = rtc.now();
      long driftSec = labs((long)ntpDt.unixtime() - (long)hwDt.unixtime());

      if (!ntpSynced || driftSec >= 2 || (millis() - lastRtcNtpSyncMs >= RTC_NTP_RESYNC_INTERVAL_MS)) {
        rtc.adjust(ntpDt);
        lastRtcNtpSyncMs = millis();
        Serial.printf("[RTC/NTP] Módulo DS3231 sincronizado com horário da internet: %04d-%02d-%02d %02d:%02d:%02d\n",
                      rtcYear, rtcMonth, rtcDay, rtcHour, rtcMinute, rtcSecond);
      }
    } else if (!ntpSynced) {
      Serial.printf("[NTP] Horário oficial da internet obtido (BRT): %04d-%02d-%02d %02d:%02d:%02d\n",
                    rtcYear, rtcMonth, rtcDay, rtcHour, rtcMinute, rtcSecond);
    }

    ntpSynced = true;
    return;
  }

  bool validRtc = false;
  if (rtcOk) {
    DateTime now = rtc.now();
    int yr  = now.year();
    int mon = now.month();
    int day = now.day();
    int hr  = now.hour();
    int min = now.minute();
    int sec = now.second();

    if (yr >= 2024 && yr <= 2099 &&
        mon >= 1 && mon <= 12 &&
        day >= 1 && day <= 31 &&
        hr >= 0 && hr <= 23 &&
        min >= 0 && min <= 59 &&
        sec >= 0 && sec <= 59) {
      rtcSecond = sec;
      rtcMinute = min;
      rtcHour   = hr;
      rtcDay    = day;
      rtcMonth  = mon;
      rtcYear   = yr;
      lastRtcTickMs = millis();
      validRtc = true;
      rtcHardwareValid = true;
    }
  }

  if (!validRtc) {
    rtcHardwareValid = false;
    // Fallback suave de 1 segundo caso esteja sem internet e sem módulo RTC válido
    unsigned long now = millis();
    while (now - lastRtcTickMs >= 1000) {
      lastRtcTickMs += 1000;
      rtcSecond++;
      if (rtcSecond >= 60) { rtcSecond = 0; rtcMinute++; }
      if (rtcMinute >= 60) { rtcMinute = 0; rtcHour++; }
      if (rtcHour >= 24) {
        shiftDateTimeHours(rtcYear, rtcMonth, rtcDay, rtcHour, 0);
      }
    }
  }
}

// Grava um novo horário configurado pelo site no Módulo RTC DS3231
void writeRtcModule(int year, int month, int day, int hour, int minute, int second) {
  rtcYear   = year;
  rtcMonth  = month;
  rtcDay    = day;
  rtcHour   = hour;
  rtcMinute = minute;
  rtcSecond = second;
  lastRtcTickMs = millis();

  if (rtcOk) {
    rtc.adjust(DateTime(year, month, day, hour, minute, second));
  }

  Serial.printf("[RTC] Novo horário gravado no módulo RTC: %04d-%02d-%02d %02d:%02d:%02d\n",
                rtcYear, rtcMonth, rtcDay, rtcHour, rtcMinute, rtcSecond);
}

String extractJsonStringField(const String& json, const String& fieldName) {
  String pattern1 = "\"" + fieldName + "\":\"";
  String pattern2 = "\"" + fieldName + "\": \"";
  int offset = pattern1.length();
  int pos = json.indexOf(pattern1);
  if (pos < 0) {
    pos = json.indexOf(pattern2);
    offset = pattern2.length();
  }
  if (pos < 0) return "";

  int quoteEnd = json.indexOf('"', pos + offset);
  if (quoteEnd < pos + offset) return "";
  return json.substring(pos + offset, quoteEnd);
}

// Interpreta rtc_datetime retornado pelo Supabase convertendo UTC (+00:00 / Z) para horário local (BRT -03:00)
void applyIsoDateTimeToRtc(const String& jsonResponse) {
  String fullIso = extractJsonStringField(jsonResponse, "rtc_datetime");
  if (fullIso.length() < 19) return;

  int y  = fullIso.substring(0, 4).toInt();
  int mo = fullIso.substring(5, 7).toInt();
  int d  = fullIso.substring(8, 10).toInt();
  int h  = fullIso.substring(11, 13).toInt();
  int mi = fullIso.substring(14, 16).toInt();
  int s  = fullIso.substring(17, 19).toInt();
  if (y < 2024) return;

  if (fullIso.indexOf("Z") >= 19 || fullIso.indexOf("+00") >= 19) {
    shiftDateTimeHours(y, mo, d, h, RTC_TZ_OFFSET_HOURS);
  }
  writeRtcModule(y, mo, d, h, mi, s);
}

// Sincroniza o DS3231 preferindo NTP ativo da internet, ou usando o horário enviado pelo site como backup
void syncRtcWithNtpOrIso(const String& jsonResponse) {
  struct tm timeinfo;
  if (WiFi.status() == WL_CONNECTED && getLocalTime(&timeinfo, 0) && (timeinfo.tm_year + 1900) >= 2025) {
    writeRtcModule(
      timeinfo.tm_year + 1900,
      timeinfo.tm_mon + 1,
      timeinfo.tm_mday,
      timeinfo.tm_hour,
      timeinfo.tm_min,
      timeinfo.tm_sec
    );
    lastRtcNtpSyncMs = millis();
    ntpSynced = true;
    return;
  }
  applyIsoDateTimeToRtc(jsonResponse);
}

String getRtcIsoString() {
  int safeY  = constrain(rtcYear, 2024, 2099);
  int safeMo = constrain(rtcMonth, 1, 12);
  int safeD  = constrain(rtcDay, 1, daysInMonth(safeY, safeMo));
  int safeH  = constrain(rtcHour, 0, 23);
  int safeMi = constrain(rtcMinute, 0, 59);
  int safeS  = constrain(rtcSecond, 0, 59);

  char buf[32];
  snprintf(buf, sizeof(buf), "%04d-%02d-%02dT%02d:%02d:%02d-03:00",
           safeY, safeMo, safeD, safeH, safeMi, safeS);
  return String(buf);
}

void disableStepperCoils() {
  mp.disableOutputs();
  digitalWrite(IN1_PIN, LOW);
  digitalWrite(IN2_PIN, LOW);
  digitalWrite(IN3_PIN, LOW);
  digitalWrite(IN4_PIN, LOW);
}

void runStepperSteps(long steps, float maxSpd, float accel) {
  long finalSteps = FEEDER_INVERT_DIR ? -steps : steps;
  mp.setMaxSpeed(maxSpd);
  mp.setAcceleration(accel);
  mp.enableOutputs();
  mp.move(finalSteps);

  unsigned long lastYieldMs = millis();
  while (mp.distanceToGo() != 0) {
    mp.run();
    if (millis() - lastYieldMs >= 10) {
      lastYieldMs = millis();
      yield();
    }
  }
}

void runFeederShake() {
  if (!FEEDER_SHAKE_ENABLED || FEEDER_SHAKE_STEPS <= 0 || FEEDER_SHAKE_REPS <= 0) return;

  mp.setMaxSpeed(FEEDER_SHAKE_SPEED);
  mp.setAcceleration(FEEDER_SHAKE_ACCEL);
  mp.enableOutputs();

  for (int i = 0; i < FEEDER_SHAKE_REPS; i++) {
    runStepperSteps(FEEDER_SHAKE_STEPS, FEEDER_SHAKE_SPEED, FEEDER_SHAKE_ACCEL);
    runStepperSteps(-FEEDER_SHAKE_STEPS, FEEDER_SHAKE_SPEED, FEEDER_SHAKE_ACCEL);
  }

  mp.setMaxSpeed(velocidadeMaxPassos);
  mp.setAcceleration(aceleracaoPassos);
}

// Registra evento do alimentador na tabela telemetry_logs (quando online)
void sendFeederEventLog(const String& message) {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.setTimeout(3500);
  String endpoint = String(SUPABASE_URL) + "/rest/v1/telemetry_logs";
  http.begin(endpoint);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);

  String activeUser = deviceUsername.length() > 0 ? deviceUsername : String("admin");
  String payload = "{\"device_username\":\"" + jsonEscape(activeUser) + "\","
                   "\"event_type\":\"feeder\","
                   "\"message\":\"" + jsonEscape(message) + "\","
                   "\"source\":\"Alimentador ESP32\"}";

  http.POST(payload);
  http.end();
}

// Atualiza rapidamente o estoque e posição da barreira no Supabase após uma ação do motor
void patchFeederStateToSupabase() {
  if (WiFi.status() != WL_CONNECTED || !feederColsSupported) return;

  String activeUser = deviceUsername.length() > 0 ? deviceUsername : String("admin");
  activeUser.trim();
  String filterEndpoint = String(SUPABASE_URL) + "/rest/v1/aquarium_status?device_username=eq." + urlEncodeValue(activeUser);

  HTTPClient http;
  http.setTimeout(3000);
  http.begin(filterEndpoint);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);

  String body = "{\"feeder_compartments_left\":" + String(feederCompartmentsLeft) +
                ",\"feeder_on_barrier\":" + String(feederOnBarrier ? "true" : "false") + "}";
  http.PATCH(body);
  http.end();
}

// Posiciona a barreira tampando o furo para reabastecimento seguro ou parada automática ao terminar a comida (sem tremidinha)
void alignFeederToBarrier(bool autoFromEmpty) {
  if (feederOnBarrier) {
    Serial.println("[ALIMENTADOR] Barreira ja esta tampando o furo (alimentacao travada / pronto para reabastecer).");
    return;
  }

  if (autoFromEmpty) {
    Serial.println("[ALIMENTADOR] Comida terminou! Alinhando BARREIRA no furo (170 passos) para parar alimentacao...");
    if (!apPortalActive) {
      lcd.setCursor(0, 0);
      lcd.print("RACAO ACABOU!   ");
      lcd.setCursor(0, 1);
      lcd.print("Travando furo...");
    }
  } else {
    Serial.println("[ALIMENTADOR] Alinhando BARREIRA no furo (170 passos) para reabastecimento...");
    if (!apPortalActive) {
      lcd.setCursor(0, 0);
      lcd.print("MODO REABASTECER");
      lcd.setCursor(0, 1);
      lcd.print("Fechando furo...");
    }
  }

  runStepperSteps(PASSOS_BARREIRA, velocidadeMaxPassos, aceleracaoPassos);
  disableStepperCoils();

  feederOnBarrier = true;
  saveFeederStateToNVS();
  patchFeederStateToSupabase();

  if (!apPortalActive) {
    lcd.setCursor(0, 0);
    lcd.print(autoFromEmpty ? "BARREIRA TRAVADA" : "BARREIRA NO FURO");
    lcd.setCursor(0, 1);
    lcd.print(autoFromEmpty ? "Aliment. Parada " : "Pode reabastecer");
    delay(800);
  }

  updateLCD();
  if (!autoFromEmpty) {
    sendFeederEventLog("Modo Reabastecer ativado: barreira posicionada tampando o furo.");
  }
}

// Confirma reabastecimento completo (12/12 compartimentos = 36g)
void confirmFeederRefill() {
  if (!feederOnBarrier) {
    alignFeederToBarrier(false);
  }

  feederCompartmentsLeft = TOTAL_FEEDER_COMPARTMENTS;
  feederOnBarrier = true;
  saveFeederStateToNVS();
  patchFeederStateToSupabase();

  Serial.printf("[ALIMENTADOR] Reabastecimento confirmado: %d/%d compartimentos (%dg).\n",
                feederCompartmentsLeft, TOTAL_FEEDER_COMPARTMENTS,
                feederCompartmentsLeft * GRAMS_PER_DOSE);

  if (!apPortalActive) {
    lcd.setCursor(0, 0);
    lcd.print("REABASTECIDO!   ");
    lcd.setCursor(0, 1);
    lcd.print("Racao: 36g 12/12");
    delay(1000);
  }

  updateLCD();
  sendFeederEventLog("Alimentador reabastecido: 12/12 compartimentos (36g).");
}

// Aciona o motor de passo do alimentador (12 compartimentos x 3g + barreiras + tremidinha)
void dispenseFoodNow(const String& portionLabel, const String& triggerReason) {
  int gramsRequested = parsePortionGrams(portionLabel);
  int dosesRequested = gramsRequested / GRAMS_PER_DOSE;

  if (feederCompartmentsLeft <= 0) {
    if (!feederOnBarrier) {
      alignFeederToBarrier(true);
    }
    Serial.println("[ALIMENTADOR] BLOQUEADO: Sem comida (0/12 = 0g)! Motor alinhado na barreira.");
    if (!apPortalActive) {
      lcd.setCursor(0, 0);
      lcd.print("SEM COMIDA! 0/12");
      lcd.setCursor(0, 1);
      lcd.print("Barreira Travada");
      delay(1200);
    }
    updateLCD();
    sendFeederEventLog("Alimentacao bloqueada: sem comida (0/12).");
    return;
  }

  int dosesToRun = min(dosesRequested, feederCompartmentsLeft);
  int gramsToRun = dosesToRun * GRAMS_PER_DOSE;

  Serial.printf("[ALIMENTADOR] %s -> Depositando %dg (%d compartimento(s) de %dg) | RTC %02d:%02d:%02d\n",
                triggerReason.c_str(), gramsToRun, dosesToRun, GRAMS_PER_DOSE, rtcHour, rtcMinute, rtcSecond);

  if (!apPortalActive) {
    char line1[17];
    snprintf(line1, sizeof(line1), "Porcao:%2dg (%dx) ", gramsToRun, dosesToRun);
    lcd.setCursor(0, 0);
    lcd.print("  ALIMENTANDO   ");
    lcd.setCursor(0, 1);
    lcd.print(line1);
  }

  for (int d = 0; d < dosesToRun; d++) {
    // Saindo da BARREIRA -> meia etapa (170 passos) até o 1º compartimento.
    // Já estando em um COMPARTIMENTO -> etapa completa (341 passos) até o próximo.
    long steps = feederOnBarrier ? PASSOS_BARREIRA : PASSOS_ALIMENTACAO;
    runStepperSteps(steps, velocidadeMaxPassos, aceleracaoPassos);
    runFeederShake();

    feederOnBarrier = false;
    if (feederCompartmentsLeft > 0) {
      feederCompartmentsLeft--;
    }
    saveFeederStateToNVS();

    if (d + 1 < dosesToRun) {
      delay(350);
    }
  }

  if (feederCompartmentsLeft <= 0) {
    // Comida terminou: aguarda a última dose cair, alinha automaticamente na barreira e para a alimentação
    delay(450);
    alignFeederToBarrier(true);
    Serial.println("[ALIMENTADOR] Comida terminou (0/12 = 0g)! Motor alinhado na BARREIRA e alimentacao parada.");
    String logMsg = triggerReason + ": " + String(gramsToRun) +
                    "g dispensados • Restam 0/12 (0g) [ACABOU]";
    sendFeederEventLog(logMsg);
    updateLCD();
    return;
  }

  // Desenergiza as bobinas do motor de passo após o depósito
  disableStepperCoils();
  delay(200);

  int gramsLeft = feederCompartmentsLeft * GRAMS_PER_DOSE;
  Serial.printf("[ALIMENTADOR] Concluido! Restam %d/%d compartimentos (%dg).\n",
                feederCompartmentsLeft, TOTAL_FEEDER_COMPARTMENTS, gramsLeft);

  String logMsg = triggerReason + ": " + String(gramsToRun) + "g dispensados • Restam " +
                  String(feederCompartmentsLeft) + "/12 (" + String(gramsLeft) + "g)";
  if (feederCompartmentsLeft <= FEEDER_CRITICAL_ALERT_COMPS) {
    logMsg += " [CRITICO - QUASE ACABANDO]";
  } else if (feederCompartmentsLeft <= FEEDER_LOW_ALERT_COMPS) {
    logMsg += " [ESTOQUE BAIXO]";
  }

  patchFeederStateToSupabase();
  sendFeederEventLog(logMsg);
  updateLCD();
}

// Verifica continuamente se o horário do módulo RTC atingiu algum horário programado do alimentador
void checkFeederByRtcTime() {
  readRtcModule();

  int currentMinuteKey = ((rtcMonth * 32 + rtcDay) * 1440) + (rtcHour * 60) + rtcMinute;
  if (rtcSecond <= 25 && currentMinuteKey != lastFedKey) {
    for (int i = 0; i < MAX_FEED_SCHEDULES; i++) {
      if (feedSchedules[i].enabled &&
          feedSchedules[i].hour == rtcHour &&
          feedSchedules[i].minute == rtcMinute) {
        lastFedKey = currentMinuteKey;
        dispenseFoodNow(feedSchedules[i].portion, "Horário do RTC atingido");
        break;
      }
    }
  }
}

// ============================================================================
// 9. SINCRONIZAÇÃO COM SUPABASE (RECEBE AJUSTE DO RTC, HORÁRIOS E WI-FI SETUP)
// ============================================================================
String urlEncodeValue(const String& str) {
  String encoded = "";
  for (size_t i = 0; i < str.length(); i++) {
    char c = str.charAt(i);
    if (isalnum((unsigned char)c) || c == '-' || c == '_' || c == '.') {
      encoded += c;
    } else if (c == ' ') {
      encoded += "%20";
    } else {
      char hex[4];
      snprintf(hex, sizeof(hex), "%%%02X", (unsigned char)c);
      encoded += hex;
    }
  }
  return encoded;
}

void syncStatusWithSupabase() {
  if (WiFi.status() != WL_CONNECTED) return;

  String activeUser = deviceUsername.length() > 0 ? deviceUsername : String("admin");
  activeUser.trim();
  String filterQuery = "device_username=eq." + urlEncodeValue(activeUser);

  HTTPClient http;
  http.setTimeout(4500); // Timeout curto para jamais congelar o loop
  String upsertEndpoint = String(SUPABASE_URL) + "/rest/v1/aquarium_status?on_conflict=device_username";
  String filterEndpoint = String(SUPABASE_URL) + "/rest/v1/aquarium_status?" + filterQuery;

  // 0. Verifica ANTES de enviar telemetria se o site pediu sincronização do RTC, alimentação, bomba, reabastecimento ou portal Wi-Fi
  String preSelect = feederColsSupported
                       ? "rtc_set_command,rtc_datetime,feed_now_command,feed_now_portion,feeder_confirm_refill_command,feeder_refill_command,wifi_setup_command,pump_relay_on,pump_mode,pump_cycle_minutes"
                       : "rtc_set_command,rtc_datetime,feed_now_command,feed_now_portion,wifi_setup_command,pump_relay_on,pump_mode,pump_cycle_minutes";
  http.begin(filterEndpoint + "&select=" + preSelect);
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
  int preCode = http.GET();

  if (preCode == 400 && feederColsSupported) {
    feederColsSupported = false;
    http.end();
    preSelect = "rtc_set_command,rtc_datetime,feed_now_command,feed_now_portion,wifi_setup_command,pump_relay_on,pump_mode,pump_cycle_minutes";
    http.begin(filterEndpoint + "&select=" + preSelect);
    http.addHeader("apikey", SUPABASE_KEY);
    http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
    preCode = http.GET();
  }

  if (preCode >= 200 && preCode < 300) {
    String preBody = http.getString();
    String dbPumpMode = extractJsonStringField(preBody, "pump_mode");
    int dbPumpCycleMin = extractJsonIntField(preBody, "pump_cycle_minutes", pumpCycleOnMin);
    if (dbPumpMode.length() > 0 && dbPumpMode != pumpModeRaw) {
      parseAndApplyPumpMode(dbPumpMode, dbPumpCycleMin, false);
    }
    if (preBody.indexOf("\"pump_relay_on\":false") >= 0 || preBody.indexOf("\"pump_relay_on\": false") >= 0) {
      if (pumpRelayOn) {
        applyPumpRelay(false);
        pumpPhaseStartMs = millis();
        savePumpConfigToNVS();
      }
    } else if (preBody.indexOf("\"pump_relay_on\":true") >= 0 || preBody.indexOf("\"pump_relay_on\": true") >= 0) {
      if (!pumpRelayOn) {
        applyPumpRelay(true);
        pumpPhaseStartMs = millis();
        savePumpConfigToNVS();
      }
    }
    if (preBody.indexOf("\"rtc_set_command\":true") >= 0 || preBody.indexOf("\"rtc_set_command\": true") >= 0) {
      syncRtcWithNtpOrIso(preBody);
      HTTPClient ackPre;
      ackPre.setTimeout(2500);
      ackPre.begin(filterEndpoint);
      ackPre.addHeader("Content-Type", "application/json");
      ackPre.addHeader("apikey", SUPABASE_KEY);
      ackPre.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
      ackPre.PATCH("{\"rtc_set_command\":false}");
      ackPre.end();
    }
    if (preBody.indexOf("\"feed_now_command\":true") >= 0 || preBody.indexOf("\"feed_now_command\": true") >= 0) {
      String portionStr = extractJsonStringField(preBody, "feed_now_portion");
      if (portionStr.length() == 0) portionStr = "3g";
      HTTPClient ackPreFeed;
      ackPreFeed.setTimeout(2500);
      ackPreFeed.begin(filterEndpoint);
      ackPreFeed.addHeader("Content-Type", "application/json");
      ackPreFeed.addHeader("apikey", SUPABASE_KEY);
      ackPreFeed.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
      int ackCode = ackPreFeed.PATCH("{\"feed_now_command\":false}");
      ackPreFeed.end();
      if (ackCode >= 200 && ackCode < 300) {
        dispenseFoodNow(portionStr, "Comando Manual do Site");
      }
    }
    if (preBody.indexOf("\"feeder_refill_command\":true") >= 0 || preBody.indexOf("\"feeder_refill_command\": true") >= 0) {
      HTTPClient ackPreRefill;
      ackPreRefill.setTimeout(2500);
      ackPreRefill.begin(filterEndpoint);
      ackPreRefill.addHeader("Content-Type", "application/json");
      ackPreRefill.addHeader("apikey", SUPABASE_KEY);
      ackPreRefill.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
      int ackCode = ackPreRefill.PATCH("{\"feeder_refill_command\":false}");
      ackPreRefill.end();
      if (ackCode >= 200 && ackCode < 300) {
        alignFeederToBarrier(false);
      }
    }
    if (preBody.indexOf("\"feeder_confirm_refill_command\":true") >= 0 || preBody.indexOf("\"feeder_confirm_refill_command\": true") >= 0) {
      HTTPClient ackPreConfirm;
      ackPreConfirm.setTimeout(2500);
      ackPreConfirm.begin(filterEndpoint);
      ackPreConfirm.addHeader("Content-Type", "application/json");
      ackPreConfirm.addHeader("apikey", SUPABASE_KEY);
      ackPreConfirm.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
      int ackCode = ackPreConfirm.PATCH("{\"feeder_confirm_refill_command\":false}");
      ackPreConfirm.end();
      if (ackCode >= 200 && ackCode < 300) {
        confirmFeederRefill();
      }
    }
    if (preBody.indexOf("\"wifi_setup_command\":true") >= 0 || preBody.indexOf("\"wifi_setup_command\": true") >= 0) {
      HTTPClient ackPreWifi;
      ackPreWifi.setTimeout(2500);
      ackPreWifi.begin(filterEndpoint);
      ackPreWifi.addHeader("Content-Type", "application/json");
      ackPreWifi.addHeader("apikey", SUPABASE_KEY);
      ackPreWifi.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
      int ackCode = ackPreWifi.PATCH("{\"wifi_setup_command\":false}");
      ackPreWifi.end();
      if (ackCode >= 200 && ackCode < 300) {
        Serial.println("\n[NETUNO] >>> Comando recebido do site: Abrindo Ponto de Acesso NETUNO-SETUP (10.0.0.1)...");
        http.end();
        startConfigPortalAP();
        return;
      }
    }
  }
  http.end();

  http.begin(upsertEndpoint);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
  http.addHeader("Prefer", "resolution=merge-duplicates,return=representation");

  String nowIso = getRtcIsoString();
  String basePayload = "{\"device_id\":\"" + jsonEscape(WiFi.macAddress()) + "\","
                       "\"device_username\":\"" + jsonEscape(activeUser) + "\","
                       "\"device_password\":\"" + jsonEscape(devicePassword) + "\","
                       "\"water_level_pct\":" + String(waterLevelPct) + ","
                       "\"distance_cm\":" + String(distanceCm, 1) + ","
                       "\"temperature_c\":" + String(temperatureC, 1) + ","
                       "\"rtc_datetime\":\"" + nowIso + "\","
                       "\"esp_last_seen\":\"" + nowIso + "\","
                       "\"wifi_rssi\":" + String(WiFi.RSSI());

  String payload = feederColsSupported
                     ? (basePayload +
                        ",\"feeder_compartments_left\":" + String(feederCompartmentsLeft) +
                        ",\"feeder_on_barrier\":" + String(feederOnBarrier ? "true" : "false") + "}")
                     : (basePayload + "}");

  int httpCode = http.POST(payload);

  // Fallback automático: caso colunas novas ainda não existam ou falte índice UNIQUE no banco
  if (httpCode == 400) {
    String errBody = http.getString();
    Serial.printf("[SUPABASE] Aviso HTTP 400 no POST: %s -> Usando fallback...\n", errBody.c_str());
    if (errBody.indexOf("feeder_") >= 0 && feederColsSupported) {
      feederColsSupported = false;
      payload = basePayload + "}";
      Serial.println("[SUPABASE] Execute supabase/schema.sql para habilitar colunas do alimentador no banco.");
    }
    http.end();

    http.begin(filterEndpoint);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("apikey", SUPABASE_KEY);
    http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
    http.addHeader("Prefer", "return=representation");
    httpCode = http.PATCH(payload);
  }

  if (httpCode >= 200 && httpCode < 300) {
    httpFailCount = 0;
    String response = http.getString();

    // Sincroniza modo e estado da bomba (GPIO 23) conforme comando salvo no Supabase
    String respPumpMode = extractJsonStringField(response, "pump_mode");
    int respPumpCycleMin = extractJsonIntField(response, "pump_cycle_minutes", pumpCycleOnMin);
    if (respPumpMode.length() > 0 && respPumpMode != pumpModeRaw) {
      parseAndApplyPumpMode(respPumpMode, respPumpCycleMin, false);
    }
    if (response.indexOf("\"pump_relay_on\":false") >= 0 || response.indexOf("\"pump_relay_on\": false") >= 0) {
      if (pumpRelayOn) {
        applyPumpRelay(false);
        pumpPhaseStartMs = millis();
        savePumpConfigToNVS();
      }
    } else if (response.indexOf("\"pump_relay_on\":true") >= 0 || response.indexOf("\"pump_relay_on\": true") >= 0) {
      if (!pumpRelayOn) {
        applyPumpRelay(true);
        pumpPhaseStartMs = millis();
        savePumpConfigToNVS();
      }
    }

    // Caso tenha chegado pedido de sincronização do RTC durante a requisição
    if (response.indexOf("\"rtc_set_command\":true") >= 0 || response.indexOf("\"rtc_set_command\": true") >= 0) {
      syncRtcWithNtpOrIso(response);
      HTTPClient ack;
      ack.setTimeout(2500);
      ack.begin(filterEndpoint);
      ack.addHeader("Content-Type", "application/json");
      ack.addHeader("apikey", SUPABASE_KEY);
      ack.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
      ack.PATCH("{\"rtc_set_command\":false}");
      ack.end();
    }
  } else {
    httpFailCount++;
    String errBody = http.getString();
    Serial.printf("[SUPABASE] Falha HTTP %d (Tentativa %d/5): %s\n", httpCode, httpFailCount, errBody.c_str());
  }
  http.end();
}

// Baixa os horários programados de alimentação da tabela feed_schedules no Supabase
void syncSchedulesFromSupabase() {
  if (WiFi.status() != WL_CONNECTED) return;

  String activeUser = deviceUsername.length() > 0 ? deviceUsername : String("admin");
  activeUser.trim();
  String endpoint = String(SUPABASE_URL) + "/rest/v1/feed_schedules?device_username=ilike." +
                    urlEncodeValue(activeUser) + "&select=time,portion,enabled&order=time.asc";

  HTTPClient http;
  http.setTimeout(4000);
  http.begin(endpoint);
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);

  int code = http.GET();
  if (code >= 200 && code < 300) {
    String body = http.getString();
    schedulesSyncedOnce = true;

    int count = 0;
    int cursor = 0;
    while (count < MAX_FEED_SCHEDULES) {
      int objStart = body.indexOf('{', cursor);
      if (objStart < 0) break;
      int objEnd = body.indexOf('}', objStart);
      if (objEnd < 0) break;

      String itemJson = body.substring(objStart, objEnd + 1);
      String timeStr = extractJsonStringField(itemJson, "time");
      String portionStr = extractJsonStringField(itemJson, "portion");
      bool isEnabled = (itemJson.indexOf("\"enabled\":false") < 0 && itemJson.indexOf("\"enabled\": false") < 0);

      int colonIdx = timeStr.indexOf(':');
      if (colonIdx > 0) {
        int hr = constrain(timeStr.substring(0, colonIdx).toInt(), 0, 23);
        int mi = constrain(timeStr.substring(colonIdx + 1).toInt(), 0, 59);
        int grams = parsePortionGrams(portionStr);

        feedSchedules[count].hour    = hr;
        feedSchedules[count].minute  = mi;
        feedSchedules[count].portion = String(grams) + "g";
        feedSchedules[count].enabled = isEnabled;
        count++;
      }
      cursor = objEnd + 1;
    }

    for (int i = count; i < MAX_FEED_SCHEDULES; i++) {
      feedSchedules[i].hour    = 0;
      feedSchedules[i].minute  = 0;
      feedSchedules[i].portion = "";
      feedSchedules[i].enabled = false;
    }
    Serial.printf("[SUPABASE] %d horário(s) de alimentação sincronizados.\n", count);
  }
  http.end();
}

void sendLogToSupabase() {
  if (WiFi.status() != WL_CONNECTED) {
    enqueueOfflineReading();
    return;
  }

  HTTPClient http;
  http.setTimeout(4500);
  String endpoint = String(SUPABASE_URL) + "/rest/v1/telemetry_logs";
  http.begin(endpoint);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);

  String activeUser = deviceUsername.length() > 0 ? deviceUsername : String("admin");
  String message = "Água: " + String(waterLevelPct) + "% • Temp: " + String(temperatureC, 1) + " °C";
  String sourceStr = "ESP32 Wi-Fi (" + connectedSsid + ")";
  String payload = "{\"device_username\":\"" + jsonEscape(activeUser) + "\","
                   "\"event_type\":\"sensor\","
                   "\"water_level_pct\":" + String(waterLevelPct) + ","
                   "\"distance_cm\":" + String(distanceCm, 1) + ","
                   "\"temperature_c\":" + String(temperatureC, 1) + ","
                   "\"message\":\"" + jsonEscape(message) + "\","
                   "\"source\":\"" + jsonEscape(sourceStr) + "\"}";

  int code = http.POST(payload);
  http.end();

  if (code < 200 || code >= 300) {
    enqueueOfflineReading();
  }
}

// ============================================================================
// SETUP & LOOP PRINCIPAL (100% NÃO-BLOQUEANTE)
// ============================================================================
void setup() {
  Serial.begin(115200);

  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  loadPumpConfigFromNVS();
  pinMode(PIN_PUMP_RELAY, OUTPUT);
  applyPumpRelay(pumpRelayOn);

  pinMode(IN1_PIN, OUTPUT);
  pinMode(IN2_PIN, OUTPUT);
  pinMode(IN3_PIN, OUTPUT);
  pinMode(IN4_PIN, OUTPUT);
  digitalWrite(IN1_PIN, LOW);
  digitalWrite(IN2_PIN, LOW);
  digitalWrite(IN3_PIN, LOW);
  digitalWrite(IN4_PIN, LOW);
  mp.setMaxSpeed(velocidadeMaxPassos);
  mp.setAcceleration(aceleracaoPassos);
  mp.disableOutputs();

  Wire.begin(PIN_LCD_SDA, PIN_LCD_SCL);
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("NETUNO AQUARIO  ");
  lcd.setCursor(0, 1);
  lcd.print("Iniciando...    ");

  rtcOk = rtc.begin();
  if (rtcOk) {
    if (rtc.lostPower()) {
      rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
    }
  } else {
    Serial.println("[RTC] Modulo DS3231 nao encontrado! Usando NTP/fallback.");
  }
  readRtcModule(); // Lê horário inicial do módulo RTC

  tempSensor.begin();
  tempSensor.setWaitForConversion(false); // Leitura não-bloqueante do sensor de temperatura

  // Registra eventos assíncronos de rede e carrega as redes Wi-Fi + estado do alimentador na memória Flash
  WiFi.onEvent(onWiFiEvent);
  loadSavedNetworksFromNVS();
  loadFeederStateFromNVS();

  // Faz a primeira leitura imediata dos sensores antes mesmo do Wi-Fi conectar
  readWaterLevel();
  readTemperature();
  updateLCD();
  lastLcdToggleMs = millis();

  // Dispara busca inteligente pela melhor rede Wi-Fi cadastrada
  startBestWifiConnection();
}

void loop() {
  unsigned long now = millis();

  // 1. Mantém o Wi-Fi sempre vivo (troca de rede se cair, reconecta ou abre Portal AP)
  maintainWiFiConnection();

  // 2. Lê o horário do Módulo RTC continuamente e aciona o alimentador nos horários programados (mesmo sem Wi-Fi!)
  checkFeederByRtcTime();

  // 2b. Executa automação da bomba de oxigênio (ciclo de tempo, horário programado e corte de segurança)
  checkPumpAutomation();

  // 3. Alterna entre Tela 0 (Nível/Temp), Tela 1 (Data/Hora + Próx.) e Tela 2 (Ração Restante) a cada 3 segundos
  if (now - lastLcdToggleMs >= 3000) {
    lastLcdToggleMs = now;
    lcdScreen = (lcdScreen + 1) % 3;
    updateLCD();
  }

  // 4. Leitura contínua dos sensores e Display LCD a cada 3 segundos (nunca trava se o Wi-Fi cair)
  if (now - lastSensorMs >= 3000) {
    lastSensorMs = now;
    readWaterLevel();
    readTemperature();
    updateLCD();

    Serial.printf(
      "[NETUNO] RTC: %02d:%02d:%02d | Agua: %d%% (%.2f L, %.1f cm) | Temp: %.1f C | Racao: %dg (%d/12 %s) | Bomba: %s | WiFi: %s (%s)\n",
      rtcHour,
      rtcMinute,
      rtcSecond,
      waterLevelPct,
      waterVolumeL,
      rawDistanceCm,
      temperatureC,
      feederCompartmentsLeft * GRAMS_PER_DOSE,
      feederCompartmentsLeft,
      feederOnBarrier ? "BARREIRA" : "COMP",
      pumpRelayOn ? "ON" : "OFF",
      (WiFi.status() == WL_CONNECTED) ? "ONLINE" : "OFFLINE",
      connectedSsid.length() > 0 ? connectedSsid.c_str() : "Sem rede"
    );
  }

  // 5. Sincronização rápida com Supabase a cada 5 segundos + esvaziamento da fila offline
  if (now - lastSupabaseMs >= 5000) {
    lastSupabaseMs = now;
    if (WiFi.status() == WL_CONNECTED) {
      syncStatusWithSupabase();
      flushOfflineQueueToSupabase();
    }
  }

  // 6. Sincroniza horários programados do site (feed_schedules) ao conectar e depois a cada 5 segundos
  if (WiFi.status() == WL_CONNECTED && (!schedulesSyncedOnce || now - lastSchedulesSyncMs >= 5000)) {
    lastSchedulesSyncMs = now;
    syncSchedulesFromSupabase();
  }

  // 7. Histórico a cada 60 segundos (se estiver sem Wi-Fi, salva na Fila Offline automaticamente)
  if (now - lastHistoryLogMs >= 60000) {
    lastHistoryLogMs = now;
    sendLogToSupabase();
  }
}
