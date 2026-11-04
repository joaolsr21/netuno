/**
 * ============================================================================
 * NETUNO — FIRMWARE ENXUTO DO ESP32 (Wi-Fi + Supabase + LCD 16x2 + Sensores)
 * ============================================================================
 * Dimensionamento do Aquário: 25 cm (C) x 13 cm (L) x 18 cm (A)
 *
 * Módulos Ativos:
 * 1. Display LCD 16x2 I2C (0x27) -> Porta 21 (SDA) e Porta 22 (SCL)
 * 2. Sensor Ultrassônico HC-SR04 -> Porta 5 (TRIG) e Porta 18 (ECHO)
 * 3. Sensor de Temperatura DS18B20 -> Porta 15 (OneWire)
 * 4. Wi-Fi + Supabase -> Envia leituras em tempo real para o site
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <OneWire.h>
#include <DallasTemperature.h>

// ===================== CONFIGURAÇÕES DE WI-FI & SUPABASE ====================
const char* WIFI_SSID     = "Iphone de JL";
const char* WIFI_PASSWORD = "12345678";

const char* SUPABASE_URL  = "https://bcdwgmhhrptygaarocjy.supabase.co";
const char* SUPABASE_KEY  = "sb_publishable_3C-PPYFJNBrzQ1msagDQAQ_1EQm7GUa";

// ===================== PINAGEM DO HARDWARE (ESP32) ==========================
#define PIN_LCD_SDA     21   // Display LCD 16x2 I2C (SDA)
#define PIN_LCD_SCL     22   // Display LCD 16x2 I2C (SCL)
#define PIN_TRIG        5    // Sensor Ultrassônico HC-SR04 (Trigger)
#define PIN_ECHO        18   // Sensor Ultrassônico HC-SR04 (Echo)
#define PIN_ONEWIRE     15   // Sensor de Temperatura DS18B20 (OneWire)

// ===================== INSTÂNCIAS DE HARDWARE ===============================
LiquidCrystal_I2C lcd(0x27, 16, 2);
OneWire oneWire(PIN_ONEWIRE);
DallasTemperature tempSensor(&oneWire);

// ===================== MEDIDAS DO AQUÁRIO (25 x 13 x 18 cm) =================
const float TANK_LENGTH_CM   = 25.0; // Comprimento (cm)
const float TANK_WIDTH_CM    = 13.0; // Largura (cm)
const float TANK_HEIGHT_CM   = 18.0; // Altura total (cm)
const float SENSOR_OFFSET_CM = 2.0;  // Margem do sensor até 100% (16 cm de coluna máxima)

// ===================== ESTADO ATUAL DOS SENSORES ============================
int   waterLevelPct = 0;
float distanceCm    = 0.0;
float waterVolumeL  = 0.0;
float temperatureC  = 0.0;

unsigned long lastCycleMs  = 0;
unsigned long lastLogMs    = 0;
unsigned long lastWifiMs   = 0;

// ============================================================================
// 1. CONEXÃO WI-FI OTIMIZADA PARA ROTEADOR DE IPHONE
// ============================================================================
void connectToWiFi() {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("WiFi: Iphone JL");
  lcd.setCursor(0, 1);
  lcd.print("Procurando...");

  WiFi.disconnect(true, true);
  delay(300);
  WiFi.mode(WIFI_STA);

  // Ajustes essenciais para conectar ESP32 no Acesso Pessoal do iPhone via USB:
  WiFi.setSleep(false);
  WiFi.setTxPower(WIFI_POWER_15dBm);       // Evita queda de tensão na USB ao transmitir
  WiFi.setMinSecurity(WIFI_AUTH_WPA_PSK);  // Compatibilidade com WPA2/WPA3 do iOS

  Serial.println("\n[WIFI] Escaneando redes 2.4 GHz...");
  int n = WiFi.scanNetworks();
  String targetSsid = WIFI_SSID;
  bool foundInScan = false;

  for (int i = 0; i < n; i++) {
    String ssid = WiFi.SSID(i);
    Serial.printf("  [%d] \"%s\" (%d dBm)\n", i + 1, ssid.c_str(), WiFi.RSSI(i));

    String sLower = ssid;
    sLower.toLowerCase();
    // Se encontrar "Iphone de JL", "iPhone de JL" ou qualquer variação de iPhone/JL, usa o nome exato!
    if (sLower.equalsIgnoreCase(WIFI_SSID) || sLower.indexOf("jl") >= 0 || sLower.indexOf("iphone") >= 0) {
      targetSsid = ssid;
      foundInScan = true;
      break;
    }
  }

  lcd.setCursor(0, 1);
  if (foundInScan) {
    Serial.println("[WIFI] Rede encontrada! Conectando em: \"" + targetSsid + "\"");
    lcd.print("Conectando...   ");
  } else {
    Serial.println("[WIFI] Aviso: \"" + String(WIFI_SSID) + "\" nao apareceu no scan 2.4GHz. Tentando mesmo assim...");
    lcd.print("Tentando WiFi...");
  }

  WiFi.begin(targetSsid.c_str(), WIFI_PASSWORD);

  int retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < 30) { // Espera até 15 segundos
    delay(500);
    Serial.print(".");
    retries++;
  }
  Serial.println();

  lcd.setCursor(0, 1);
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("[WIFI] CONECTADO! IP: " + WiFi.localIP().toString());
    lcd.print("WiFi Conectado! ");
  } else {
    Serial.printf("[WIFI] Falhou (Codigo status: %d)\n", (int)WiFi.status());
    lcd.print("Sem WiFi (Err" + String((int)WiFi.status()) + ") ");
  }
  delay(1500);
}

// ============================================================================
// 2. LEITURA DO SENSOR ULTRASSÔNICO (HC-SR04) E TEMPERATURA (DS18B20)
// ============================================================================
void readWaterLevel() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);

  long duration = pulseIn(PIN_ECHO, HIGH, 30000); // Timeout 30ms
  if (duration > 0) {
    float measuredCm = (duration * 0.0343) / 2.0;
    distanceCm = constrain(measuredCm, 0.5f, TANK_HEIGHT_CM);

    float maxColumn   = TANK_HEIGHT_CM - SENSOR_OFFSET_CM; // 16.0 cm (100%)
    float waterColumn = constrain(TANK_HEIGHT_CM - distanceCm, 0.0f, maxColumn);

    int pct = round((waterColumn / maxColumn) * 100.0);
    waterLevelPct = constrain(pct, 0, 100);
    waterVolumeL  = (TANK_LENGTH_CM * TANK_WIDTH_CM * waterColumn) / 1000.0;
  }
}

void readTemperature() {
  tempSensor.requestTemperatures();
  float t = tempSensor.getTempCByIndex(0);

  if (t != DEVICE_DISCONNECTED_C && t > -40.0 && t < 85.0) {
    temperatureC = t;
  } else {
    Serial.println("[AVISO] Sensor DS18B20 (porta 15) desconectado ou sem resistor 4.7k.");
  }
}

void updateLCD() {
  char line0[17];
  char line1[17];

  // Linha 0: "Agua: 85%  4.4cm"
  snprintf(line0, sizeof(line0), "Agua:%3d%% %4.1fcm", waterLevelPct, distanceCm);
  // Linha 1: "Temp:26.0C WiFi+"
  snprintf(
    line1,
    sizeof(line1),
    "Temp:%4.1fC %s",
    temperatureC,
    (WiFi.status() == WL_CONNECTED) ? "WiFi+" : "Offln"
  );

  lcd.setCursor(0, 0);
  lcd.print(line0);
  lcd.setCursor(0, 1);
  lcd.print(line1);
}

// ============================================================================
// 3. ENVIO EM TEMPO REAL PARA O SUPABASE
// ============================================================================
void sendStatusToSupabase() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String endpoint = String(SUPABASE_URL) + "/rest/v1/aquarium_status?id=eq.1";
  http.begin(endpoint);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);

  String payload = "{\"water_level_pct\":" + String(waterLevelPct) + ","
                   "\"distance_cm\":" + String(distanceCm, 1) + ","
                   "\"temperature_c\":" + String(temperatureC, 1) + ","
                   "\"wifi_rssi\":" + String(WiFi.RSSI()) + "}";

  int httpCode = http.PATCH(payload);
  http.end();

  if (httpCode >= 200 && httpCode < 300) {
    Serial.println("[SUPABASE] Status atualizado com sucesso!");
  } else {
    Serial.printf("[SUPABASE] Erro ao atualizar status: HTTP %d\n", httpCode);
  }
}

void sendLogToSupabase() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String endpoint = String(SUPABASE_URL) + "/rest/v1/telemetry_logs";
  http.begin(endpoint);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);

  String message = "Água: " + String(waterLevelPct) + "% (" + String(distanceCm, 1) + " cm) • Temp: " + String(temperatureC, 1) + " °C";
  String payload = "{\"event_type\":\"sensor\","
                   "\"water_level_pct\":" + String(waterLevelPct) + ","
                   "\"distance_cm\":" + String(distanceCm, 1) + ","
                   "\"temperature_c\":" + String(temperatureC, 1) + ","
                   "\"message\":\"" + message + "\","
                   "\"source\":\"ESP32 Wi-Fi\"}";

  http.POST(payload);
  http.end();
}

// ============================================================================
// SETUP & LOOP PRINCIPAL
// ============================================================================
void setup() {
  Serial.begin(115200);

  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);

  // Inicializa I2C (SDA=21, SCL=22), LCD 16x2 (0x27) e Sensor DS18B20 (GPIO 15)
  Wire.begin(PIN_LCD_SDA, PIN_LCD_SCL);
  lcd.init();
  lcd.backlight();

  tempSensor.begin();

  // Conecta no Wi-Fi "Iphone de JL"
  connectToWiFi();

  // Primeira leitura imediata dos sensores
  readWaterLevel();
  readTemperature();
  updateLCD();

  if (WiFi.status() == WL_CONNECTED) {
    sendStatusToSupabase();
    sendLogToSupabase();
  }
}

void loop() {
  unsigned long now = millis();

  // Ciclo principal a cada 4 segundos
  if (now - lastCycleMs >= 4000) {
    lastCycleMs = now;

    // 1. Lê sensores e atualiza LCD 16x2
    readWaterLevel();
    readTemperature();
    updateLCD();

    Serial.printf(
      "[SENSORES] Agua: %d%% (Dist: %.1f cm | Vol: %.2f L) | Temp: %.1f C | WiFi: %s\n",
      waterLevelPct,
      distanceCm,
      waterVolumeL,
      temperatureC,
      (WiFi.status() == WL_CONNECTED) ? "CONECTADO" : "OFFLINE"
    );

    // 2. Envia dados ao Supabase se estiver conectado
    if (WiFi.status() == WL_CONNECTED) {
      sendStatusToSupabase();

      // Salva histórico a cada 60 segundos
      if (now - lastLogMs >= 60000) {
        lastLogMs = now;
        sendLogToSupabase();
      }
    } else if (now - lastWifiMs >= 20000) {
      // Se não estiver conectado, tenta novamente a cada 20s
      lastWifiMs = now;
      Serial.println("[WIFI] Reconectando em \"" + String(WIFI_SSID) + "\"...");
      WiFi.disconnect();
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }
  }
}
