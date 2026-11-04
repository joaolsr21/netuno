<div align="center">
  <img src="./public/logo-netuno.jpg" alt="Logo Netuno" width="140" style="border-radius: 20px;" />
  <h1>NETUNO</h1>
  <p><strong>Sistema de Aquário Inteligente — ESP32 • Supabase • Vercel • Android (.APK)</strong></p>
</div>

---

## Visão Geral da Arquitetura

O **Netuno** monitora o nível da água (sensor ultrassônico `HC-SR04`), controla a bomba de oxigênio (módulo relé) e aciona o alimentador automático (servo motor) utilizando uma arquitetura **Offline-First Híbrida (Wi-Fi + Bluetooth BLE)**:

1. **Com Wi-Fi Normal:** O `ESP32` sincroniza leituras e recebe comandos em tempo real pelo **Supabase**, atualizando simultaneamente o **Site na Vercel** e o **App Android (`.APK`)**.
2. **Queda de Internet (Buffer Offline no ESP32):** Se o Wi-Fi cair, o `ESP32` grava os eventos na memória Flash interna (`LittleFS` em `/offline_queue.jsonl`) e reenvia todo o lote automaticamente ao Supabase assim que o Wi-Fi retorna.
3. **Modo Bluetooth Direto no `.APK` (BLE):** Sem Wi-Fi, o aplicativo Android chaveia para **Bluetooth Low Energy (`NETUNO_ESP32`)**, permitindo controlar a bomba/alimentador localmente e resgatar a fila offline pelo celular (repassando ao Supabase via 4G/5G).

---

## Estrutura do Repositório

```text
netuno/
├── public/                 # Assets estáticos e logo oficial Netuno
├── src/                    # Painel Web (React + Vite + Tailwind CSS) pronto para Vercel
│   ├── lib/supabase.js     # Cliente Supabase Realtime (com fallback local automático)
│   └── App.jsx             # Interface principal do site
├── mobile-app/             # Aplicativo Android exclusivo (.APK em React Native / Expo)
│   ├── src/services/       # Serviço Bluetooth Low Energy (BLE GATT)
│   ├── src/hooks/          # Hook híbrido Wi-Fi (Supabase) <-> Bluetooth (BLE)
│   ├── app.json            # Permissões Android BLE, ícone e splash screen
│   ├── eas.json            # Perfil para gerar arquivo .APK instalável
│   └── App.js              # Interface nativa Android
├── esp32-firmware/
│   └── netuno_esp32.ino    # Código base do ESP32 (HC-SR04 + Relé + Servo + LittleFS + BLE)
└── supabase/
    └── schema.sql          # Script SQL das tabelas e Realtime no Supabase
```

---

## Como Rodar e Publicar Cada Parte

### 1. Site Web (Local & Deploy na Vercel)
```bash
npm install
npm run dev
```
* Para publicar na **Vercel**, basta importar este repositório (`root directory: ./`).
* Quando criar o banco no Supabase, configure as variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (veja `.env.example`). Sem elas, o painel roda automaticamente em **Modo Simulação Base**.

### 2. Banco de Dados (Supabase)
1. Crie um projeto gratuito no [Supabase](https://supabase.com/).
2. Abra o **SQL Editor**, cole o conteúdo de [`supabase/schema.sql`](./supabase/schema.sql) e clique em **Run**.

### 3. Aplicativo Android (`.APK`)
```bash
cd mobile-app
npm install
npx expo start
```
Para gerar o instalador **`.apk`** para Android via Expo EAS:
```bash
npm install -g eas-cli
eas login
npm run build:apk
```

### 4. Firmware do ESP32
Abra [`esp32-firmware/netuno_esp32.ino`](./esp32-firmware/netuno_esp32.ino) na **Arduino IDE** ou **PlatformIO**, preencha `WIFI_SSID`, `WIFI_PASSWORD`, `SUPABASE_URL` e `SUPABASE_KEY`, e grave na placa ESP32:
* **Sensor Ultrassônico (`HC-SR04`):** `GPIO 5` (`TRIG`) e `GPIO 18` (`ECHO`)
* **Módulo Relé (Bomba de Oxigênio):** `GPIO 26`
* **Servo Motor (Alimentador):** `GPIO 14`
