/**
 * ============================================================================
 * NETUNO — FIRMWARE ULTRA ROBUSTO DO ESP32 (Multi-WiFi + Anti-Falha + Portal)
 * ============================================================================
 * Dimensionamento Padrão do Aquário: 25 cm (C) x 13 cm (L) x 18 cm (A)
 *
 * Módulos Ativos:
 * 1. Display LCD 16x2 I2C (0x27) -> Porta 21 (SDA) e Porta 22 (SCL)
 * 2. Sensor Ultrassônico HC-SR04 -> Porta 5 (TRIG) e Porta 18 (ECHO)
 * 3. Sensor de Temperatura DS18B20 -> Porta 15 (OneWire)
 * 4. Multi-WiFi Resiliente + Fila Offline + Portal AP ("NETUNO-SETUP")
 */

#include <WiFi.h>
#include <WiFiMulti.h>
#include <WebServer.h>
#include <Preferences.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <OneWire.h>
#include <DallasTemperature.h>

// ===================== CONFIGURAÇÃO SUPABASE ================================
const char* SUPABASE_URL = "https://bcdwgmhhrptygaarocjy.supabase.co";
const char* SUPABASE_KEY = "sb_publishable_3C-PPYFJNBrzQ1msagDQAQ_1EQm7GUa";

// ===================== PINAGEM DO HARDWARE (ESP32) ==========================
#define PIN_LCD_SDA     21   // Barramento I2C: Display LCD 16x2 (0x27) + Módulo RTC (0x68)
#define PIN_LCD_SCL     22   // Barramento I2C: Display LCD 16x2 (0x27) + Módulo RTC (0x68)
#define PIN_TRIG        5    // Sensor Ultrassônico HC-SR04 (Trigger)
#define PIN_ECHO        18   // Sensor Ultrassônico HC-SR04 (Echo)
#define PIN_ONEWIRE     15   // Sensor de Temperatura DS18B20 (OneWire)
#define PIN_FEEDER_PWM  13   // Saída do Alimentador Automático (Servo / Motor)
#define RTC_I2C_ADDR    0x68 // Endereço I2C padrão do Módulo RTC (DS3231 / DS1307)

// ===================== HORÁRIOS PROGRAMADOS DO ALIMENTADOR (BASEADOS NO RTC) =
#define MAX_FEED_SCHEDULES 8

struct FeedScheduleItem {
  int    hour;
  int    minute;
  String portion;
  bool   enabled;
};

FeedScheduleItem feedSchedules[MAX_FEED_SCHEDULES] = {
  { 8,  0,  "Padrao (5g)", true  },
  { 14, 0,  "Leve (3g)",   true  },
  { 20, 0,  "Padrao (5g)", true  },
  { 0,  0,  "",            false },
  { 0,  0,  "",            false },
  { 0,  0,  "",            false },
  { 0,  0,  "",            false },
  { 0,  0,  "",            false }
};

// Estado atual do Relógio do Módulo RTC
int rtcYear   = 2026;
int rtcMonth  = 11;
int rtcDay    = 9;
int rtcHour   = 8;
int rtcMinute = 0;
int rtcSecond = 0;
int lastFedKey = -1; // Evita alimentar duas vezes no mesmo minuto do RTC
unsigned long lastRtcTickMs = 0;

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
Preferences prefs;
WebServer portalServer(80);

// ===================== MEDIDAS DO AQUÁRIO (25 x 13 x 18 cm) =================
float tankLengthCm   = 25.0; // Comprimento (cm)
float tankWidthCm    = 13.0; // Largura (cm)
float tankHeightCm   = 18.0; // Altura total (cm)
float sensorOffsetCm = 2.0;  // Margem do sensor até 100%

// ===================== ESTADO ATUAL DOS SENSORES E WI-FI ====================
int   waterLevelPct = 0;
float distanceCm    = 0.0;
float waterVolumeL  = 0.0;
float temperatureC  = 26.0;

enum WifiState {
  WIFI_STATE_DISCONNECTED,
  WIFI_STATE_CONNECTING,
  WIFI_STATE_CONNECTED,
  WIFI_STATE_PORTAL_AP
};

WifiState wifiState         = WIFI_STATE_DISCONNECTED;
String    connectedSsid     = "";
int       currentNetIndex   = -1;
int       consecutiveFails  = 0;
int       httpFailCount     = 0;
bool      apPortalActive    = false;

unsigned long lastSensorMs      = 0;
unsigned long lastSupabaseMs    = 0;
unsigned long lastHistoryLogMs  = 0;
unsigned long lastWifiAttemptMs = 0;
unsigned long connectStartMs    = 0;
unsigned long apPortalStartMs   = 0;

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
  prefs.end();

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
// 3. PORTAL DE CONFIGURAÇÃO LOCAL (AP "NETUNO-SETUP" -> 192.168.4.1)
//    Permite cadastrar múltiplas redes Wi-Fi direto pelo celular/PC
// ============================================================================
void handlePortalRoot() {
  String html = "<!DOCTYPE html><html><head><meta charset='utf-8'>";
  html += "<meta name='viewport' content='width=device-width,initial-scale=1'>";
  html += "<title>Netuno - Configurar Wi-Fi</title>";
  html += "<style>body{font-family:sans-serif;background:#06101E;color:#fff;padding:18px;margin:0}";
  html += ".card{max-width:440px;margin:0 auto;background:#0B1D35;border:1px solid #1A539B;border-radius:16px;padding:20px}";
  html += "h2{margin-top:0;color:#38bdf8}label{display:block;font-size:12px;color:#bae6fd;margin:10px 0 4px}";
  html += "input{width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #1A539B;background:#06101E;color:#fff}";
  html += "button{width:100%;margin-top:16px;padding:12px;border:0;border-radius:10px;background:#10b981;color:#052e16;font-weight:bold;cursor:pointer}";
  html += ".net{font-size:12px;padding:6px 10px;background:#06101E;border-radius:8px;margin-bottom:6px;border:1px solid #1e3a8a}</style></head><body>";
  html += "<div class='card'><h2>Netuno • Multi-WiFi</h2>";
  html += "<p style='font-size:13px;color:#93c5fd'>Cadastre até 5 redes Wi-Fi (2.4GHz). O ESP32 escolherá automaticamente a rede com melhor sinal.</p>";

  html += "<h4 style='margin-bottom:8px;color:#7dd3fc'>Redes Salvas na Memória:</h4>";
  for (int i = 0; i < MAX_SAVED_WIFI; i++) {
    html += "<div class='net'><strong>Rede " + String(i + 1) + ":</strong> ";
    html += (savedNetworks[i].enabled && savedNetworks[i].ssid.length() > 0)
              ? savedNetworks[i].ssid
              : "<em>(Vazio)</em>";
    html += "</div>";
  }

  html += "<form method='POST' action='/save'>";
  html += "<label>Adicionar / Atualizar Nome do Wi-Fi (SSID):</label>";
  html += "<input name='ssid' placeholder='Ex: Casa_Fibra_2.4G' required>";
  html += "<label>Senha do Wi-Fi:</label>";
  html += "<input name='pass' type='password' placeholder='Senha da rede'>";
  html += "<button type='submit'>Salvar Rede e Conectar</button>";
  html += "</form></div></body></html>";

  portalServer.send(200, "text/html", html);
}

void handlePortalSave() {
  String newSsid = portalServer.arg("ssid");
  String newPass = portalServer.arg("pass");

  if (newSsid.length() > 0) {
    addOrUpdateWifiNetwork(newSsid, newPass);
  }

  portalServer.send(
    200,
    "text/html",
    "<html><body style='background:#06101E;color:#34d399;font-family:sans-serif;text-align:center;padding:40px'>"
    "<h2>Rede Wi-Fi Salva com Sucesso!</h2><p>Reconectando o sistema Netuno...</p></body></html>"
  );

  delay(800);
  apPortalActive = false;
  portalServer.stop();
  WiFi.softAPdisconnect(true);
  wifiState = WIFI_STATE_DISCONNECTED;
  consecutiveFails = 0;
}

void startConfigPortalAP() {
  if (apPortalActive) return;

  Serial.println("\n[PORTAL AP] Iniciando Ponto de Acesso \"NETUNO-SETUP\" (IP: 192.168.4.1)...");
  WiFi.disconnect(true);
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP("NETUNO-SETUP");

  portalServer.on("/", HTTP_GET, handlePortalRoot);
  portalServer.on("/save", HTTP_POST, handlePortalSave);
  portalServer.begin();

  apPortalActive  = true;
  apPortalStartMs = millis();
  wifiState       = WIFI_STATE_PORTAL_AP;

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Configurar WiFi:");
  lcd.setCursor(0, 1);
  lcd.print("AP: NETUNO-SETUP");
}

// ============================================================================
// 4. GERENCIADOR MULTI-WIFI INTELIGENTE (ESCOLHE O MELHOR SINAL 2.4GHz)
// ============================================================================
void startBestWifiConnection() {
  if (apPortalActive) return;

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

  // Se o Portal AP estiver aberto, processa clientes HTTP e tenta reconectar às redes salvas a cada 3 min
  if (apPortalActive) {
    portalServer.handleClient();
    if (now - apPortalStartMs >= 180000) {
      Serial.println("[PORTAL AP] Tempo de portal concluído. Retomando busca por redes salvas...");
      apPortalActive = false;
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

  String message = "[Recuperado Offline] Água: " + String(item.waterPct) + "% • Temp: " + String(item.tempC, 1) + " °C";
  String payload = "{\"event_type\":\"sync\","
                   "\"water_level_pct\":" + String(item.waterPct) + ","
                   "\"distance_cm\":" + String(item.distanceCm, 1) + ","
                   "\"temperature_c\":" + String(item.tempC, 1) + ","
                   "\"message\":\"" + message + "\","
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
// 7. LEITURA DOS SENSORES COM FILTRO DE MEDIANA (EVITA PICOS DE RUÍDO)
// ============================================================================
void readWaterLevel() {
  float samples[3];
  int validSamples = 0;

  for (int i = 0; i < 3; i++) {
    digitalWrite(PIN_TRIG, LOW);
    delayMicroseconds(2);
    digitalWrite(PIN_TRIG, HIGH);
    delayMicroseconds(10);
    digitalWrite(PIN_TRIG, LOW);

    long duration = pulseIn(PIN_ECHO, HIGH, 28000);
    if (duration > 0) {
      samples[validSamples++] = (duration * 0.0343f) / 2.0f;
    }
    delay(15);
  }

  if (validSamples > 0) {
    float measuredCm = samples[0];
    if (validSamples == 3) {
      // Ordena as 3 amostras e pega a mediana para descartar reflexos falsos na água
      for (int i = 0; i < 2; i++) {
        for (int j = i + 1; j < 3; j++) {
          if (samples[j] < samples[i]) {
            float tmp  = samples[i];
            samples[i] = samples[j];
            samples[j] = tmp;
          }
        }
      }
      measuredCm = samples[1];
    }

    distanceCm = constrain(measuredCm, 0.5f, tankHeightCm);

    float maxColumn   = max(1.0f, tankHeightCm - sensorOffsetCm);
    float waterColumn = constrain(tankHeightCm - distanceCm, 0.0f, maxColumn);

    int pct       = round((waterColumn / maxColumn) * 100.0f);
    waterLevelPct = constrain(pct, 0, 100);
    waterVolumeL  = (tankLengthCm * tankWidthCm * waterColumn) / 1000.0f;
  }
}

void readTemperature() {
  tempSensor.requestTemperatures();
  float t = tempSensor.getTempCByIndex(0);

  if (t != DEVICE_DISCONNECTED_C && t > -40.0f && t < 85.0f) {
    temperatureC = t;
  }
}

void updateLCD() {
  if (apPortalActive) return; // Mantém mensagem do Portal AP visível quando ativo

  char line0[17];
  char line1[17];

  snprintf(line0, sizeof(line0), "Nivel Agua: %3d%%", waterLevelPct);
  snprintf(
    line1,
    sizeof(line1),
    "Temp:%4.1fC %s",
    temperatureC,
    (WiFi.status() == WL_CONNECTED) ? "WiFi+" : "Local"
  );

  lcd.setCursor(0, 0);
  lcd.print(line0);
  lcd.setCursor(0, 1);
  lcd.print(line1);
}

// ============================================================================
// 8. MÓDULO RTC (LEITURA/GRAVAÇÃO I2C 0x68) + ALIMENTADOR BASEADO NO RTC
// ============================================================================
uint8_t decToBcd(int val) {
  return (uint8_t)((val / 10 * 16) + (val % 10));
}

int bcdToDec(uint8_t val) {
  return (int)((val / 16 * 10) + (val % 16));
}

// Lê data e hora diretamente dos registradores do módulo RTC via I2C (ou avança fallback se desconectado)
void readRtcModule() {
  Wire.beginTransmission(RTC_I2C_ADDR);
  Wire.write(0x00);
  if (Wire.endTransmission() == 0 && Wire.requestFrom(RTC_I2C_ADDR, 7) == 7) {
    rtcSecond = bcdToDec(Wire.read() & 0x7F);
    rtcMinute = bcdToDec(Wire.read() & 0x7F);
    rtcHour   = bcdToDec(Wire.read() & 0x3F);
    Wire.read(); // Dia da semana
    rtcDay    = bcdToDec(Wire.read() & 0x3F);
    rtcMonth  = bcdToDec(Wire.read() & 0x1F);
    rtcYear   = 2000 + bcdToDec(Wire.read());
    lastRtcTickMs = millis();
  } else {
    // Fallback suave de 1 segundo caso o módulo RTC esteja sem bateria/desconectado no momento
    unsigned long now = millis();
    while (now - lastRtcTickMs >= 1000) {
      lastRtcTickMs += 1000;
      rtcSecond++;
      if (rtcSecond >= 60) { rtcSecond = 0; rtcMinute++; }
      if (rtcMinute >= 60) { rtcMinute = 0; rtcHour = (rtcHour + 1) % 24; }
    }
  }
}

// Grava um novo horário configurado pelo site diretamente nos registradores do Módulo RTC (0x68)
void writeRtcModule(int year, int month, int day, int hour, int minute, int second) {
  rtcYear   = year;
  rtcMonth  = month;
  rtcDay    = day;
  rtcHour   = hour;
  rtcMinute = minute;
  rtcSecond = second;
  lastRtcTickMs = millis();

  Wire.beginTransmission(RTC_I2C_ADDR);
  Wire.write(0x00);
  Wire.write(decToBcd(second));
  Wire.write(decToBcd(minute));
  Wire.write(decToBcd(hour));
  Wire.write(decToBcd(1)); // Dia da semana
  Wire.write(decToBcd(day));
  Wire.write(decToBcd(month));
  Wire.write(decToBcd(year % 100));
  Wire.endTransmission();

  Serial.printf("[RTC] Novo horário gravado no módulo RTC: %04d-%02d-%02d %02d:%02d:%02d\n",
                rtcYear, rtcMonth, rtcDay, rtcHour, rtcMinute, rtcSecond);
}

String getRtcIsoString() {
  char buf[26];
  snprintf(buf, sizeof(buf), "%04d-%02d-%02dT%02d:%02d:%02dZ",
           rtcYear, rtcMonth, rtcDay, rtcHour, rtcMinute, rtcSecond);
  return String(buf);
}

// Aciona o motor/servo do alimentador conforme a porção escolhida
void dispenseFoodNow(const String& portionLabel, const String& triggerReason) {
  int pulseMs = 700; // Padrão (5g)
  if (portionLabel.indexOf("Leve") >= 0) pulseMs = 400;
  else if (portionLabel.indexOf("Generosa") >= 0) pulseMs = 1100;

  Serial.printf("[ALIMENTADOR] %s -> Dispensando porção \"%s\" (%d ms) no horário RTC %02d:%02d:%02d\n",
                triggerReason.c_str(), portionLabel.c_str(), pulseMs, rtcHour, rtcMinute, rtcSecond);

  digitalWrite(PIN_FEEDER_PWM, HIGH);
  delay(pulseMs);
  digitalWrite(PIN_FEEDER_PWM, LOW);
}

// Verifica a cada segundo se o horário do módulo RTC atingiu algum horário programado do alimentador
void checkFeederByRtcTime() {
  readRtcModule();

  int currentMinuteKey = (rtcDay * 10000) + (rtcHour * 100) + rtcMinute;
  if (rtcSecond <= 3 && currentMinuteKey != lastFedKey) {
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
void syncStatusWithSupabase() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.setTimeout(4500); // Timeout curto para jamais congelar o loop
  String endpoint = String(SUPABASE_URL) + "/rest/v1/aquarium_status?id=eq.1";
  http.begin(endpoint);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
  http.addHeader("Prefer", "return=representation");

  String payload = "{\"water_level_pct\":" + String(waterLevelPct) + ","
                   "\"distance_cm\":" + String(distanceCm, 1) + ","
                   "\"temperature_c\":" + String(temperatureC, 1) + ","
                   "\"rtc_datetime\":\"" + getRtcIsoString() + "\","
                   "\"wifi_rssi\":" + String(WiFi.RSSI()) + "}";

  int httpCode = http.PATCH(payload);

  if (httpCode >= 200 && httpCode < 300) {
    httpFailCount = 0;
    String response = http.getString();

    // 1. Se o usuário ajustou o horário do módulo RTC pelo site ("rtc_set_command":true)
    if (response.indexOf("\"rtc_set_command\":true") >= 0) {
      int pos = response.indexOf("\"rtc_datetime\":\"");
      if (pos >= 0 && response.length() >= pos + 35) {
        String iso = response.substring(pos + 16, pos + 35); // YYYY-MM-DDTHH:MM:SS
        int y  = iso.substring(0, 4).toInt();
        int mo = iso.substring(5, 7).toInt();
        int d  = iso.substring(8, 10).toInt();
        int h  = iso.substring(11, 13).toInt();
        int mi = iso.substring(14, 16).toInt();
        int s  = iso.substring(17, 19).toInt();
        if (y >= 2024) {
          writeRtcModule(y, mo, d, h, mi, s);
        }
      }
      // Limpa a flag rtc_set_command no banco
      HTTPClient ack;
      ack.begin(endpoint);
      ack.addHeader("Content-Type", "application/json");
      ack.addHeader("apikey", SUPABASE_KEY);
      ack.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
      ack.PATCH("{\"rtc_set_command\":false}");
      ack.end();
    }

    // 2. Se o usuário clicou em "Alimentar Agora" pelo site ("feed_now_command":true)
    if (response.indexOf("\"feed_now_command\":true") >= 0) {
      dispenseFoodNow("Padrao (5g)", "Comando Manual do Site");
      HTTPClient ackFeed;
      ackFeed.begin(endpoint);
      ackFeed.addHeader("Content-Type", "application/json");
      ackFeed.addHeader("apikey", SUPABASE_KEY);
      ackFeed.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
      ackFeed.PATCH("{\"feed_now_command\":false}");
      ackFeed.end();
    }

    // 3. Se o site enviou comando para abrir o portal de configuração Wi-Fi
    if (response.indexOf("\"wifi_setup_command\":true") >= 0) {
      HTTPClient ackWifi;
      ackWifi.begin(endpoint);
      ackWifi.addHeader("Content-Type", "application/json");
      ackWifi.addHeader("apikey", SUPABASE_KEY);
      ackWifi.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
      ackWifi.PATCH("{\"wifi_setup_command\":false}");
      ackWifi.end();
      http.end();
      startConfigPortalAP();
      return;
    }
  } else {
    httpFailCount++;
    Serial.printf("[SUPABASE] Falha HTTP %d (Tentativa %d/5)\n", httpCode, httpFailCount);
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

  String message = "Água: " + String(waterLevelPct) + "% • Temp: " + String(temperatureC, 1) + " °C";
  String payload = "{\"event_type\":\"sensor\","
                   "\"water_level_pct\":" + String(waterLevelPct) + ","
                   "\"distance_cm\":" + String(distanceCm, 1) + ","
                   "\"temperature_c\":" + String(temperatureC, 1) + ","
                   "\"message\":\"" + message + "\","
                   "\"source\":\"ESP32 Wi-Fi (" + connectedSsid + ")\"}";

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
  pinMode(PIN_FEEDER_PWM, OUTPUT);
  digitalWrite(PIN_FEEDER_PWM, LOW);

  Wire.begin(PIN_LCD_SDA, PIN_LCD_SCL);
  readRtcModule(); // Lê horário inicial do módulo RTC
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("NETUNO AQUARIO  ");
  lcd.setCursor(0, 1);
  lcd.print("Iniciando...    ");

  tempSensor.begin();
  tempSensor.setWaitForConversion(false); // Leitura não-bloqueante do sensor de temperatura

  // Registra eventos assíncronos de rede e carrega as redes Wi-Fi salvas na memória Flash
  WiFi.onEvent(onWiFiEvent);
  loadSavedNetworksFromNVS();

  // Faz a primeira leitura imediata dos sensores antes mesmo do Wi-Fi conectar
  readWaterLevel();
  readTemperature();
  updateLCD();

  // Dispara busca inteligente pela melhor rede Wi-Fi cadastrada
  startBestWifiConnection();
}

void loop() {
  unsigned long now = millis();

  // 1. Mantém o Wi-Fi sempre vivo (troca de rede se cair, reconecta ou abre Portal AP)
  maintainWiFiConnection();

  // 2. Lê o horário do Módulo RTC continuamente e aciona o alimentador nos horários programados (mesmo sem Wi-Fi!)
  checkFeederByRtcTime();

  // 3. Leitura contínua dos sensores e Display LCD a cada 3 segundos (nunca trava se o Wi-Fi cair)
  if (now - lastSensorMs >= 3000) {
    lastSensorMs = now;
    readWaterLevel();
    readTemperature();
    updateLCD();

    Serial.printf(
      "[NETUNO] RTC: %02d:%02d:%02d | Agua: %d%% (%.2f L) | Temp: %.1f C | WiFi: %s (%s)\n",
      rtcHour,
      rtcMinute,
      rtcSecond,
      waterLevelPct,
      waterVolumeL,
      temperatureC,
      (WiFi.status() == WL_CONNECTED) ? "ONLINE" : "OFFLINE",
      connectedSsid.length() > 0 ? connectedSsid.c_str() : "Sem rede"
    );
  }

  // 3. Sincronização rápida com Supabase a cada 5 segundos + esvaziamento da fila offline
  if (now - lastSupabaseMs >= 5000) {
    lastSupabaseMs = now;
    if (WiFi.status() == WL_CONNECTED) {
      syncStatusWithSupabase();
      flushOfflineQueueToSupabase();
    }
  }

  // 4. Histórico a cada 60 segundos (se estiver sem Wi-Fi, salva na Fila Offline automaticamente)
  if (now - lastHistoryLogMs >= 60000) {
    lastHistoryLogMs = now;
    sendLogToSupabase();
  }
}
