import React, { useState, useEffect } from 'react';
import {
  Waves,
  Thermometer,
  Monitor,
  Wifi,
  WifiOff,
  Activity,
  AlertTriangle,
  RefreshCw,
  Database,
  Cpu,
  Sliders,
  TrendingUp,
  ChevronRight,
  Gauge
} from 'lucide-react';
import { supabase, isSupabaseConfigured } from './lib/supabase';

// Histórico inicial (como vem da tabela `telemetry_logs` do Supabase)
const INITIAL_HISTORY = [
  { time: '00:00', level: 88, distance: 3.9, temp: 25.4 },
  { time: '04:00', level: 87, distance: 4.1, temp: 25.1 },
  { time: '08:00', level: 86, distance: 4.2, temp: 25.6 },
  { time: '12:00', level: 85, distance: 4.4, temp: 26.2 },
  { time: '16:00', level: 84, distance: 4.6, temp: 26.4 },
  { time: '20:00', level: 85, distance: 4.4, temp: 26.0 },
  { time: 'Agora', level: 85, distance: 4.4, temp: 26.0 },
];

const INITIAL_LOGS = [
  {
    id: 101,
    time: 'Agora',
    type: 'sensor',
    message: 'Leitura estabilizada: Água 85% (4.4 cm) • Temp: 26.0 °C',
    source: 'ESP32 Wi-Fi',
  },
];

export default function App() {
  //Dimensões reais do aquário: 25cm (C) x 13cm (L) x 18cm (A)
  const TANK_LENGTH_CM = 25;
  const TANK_WIDTH_CM = 13;
  const TANK_HEIGHT_CM = 18;
  const SENSOR_OFFSET_CM = 2; // Margem do sensor até 100% (16 cm de coluna máxima)
  const MAX_COLUMN_CM = TANK_HEIGHT_CM - SENSOR_OFFSET_CM; // 16 cm

  // Estado de conexão do ESP32
  const [espOnline, setEspOnline] = useState(true);
  const [wifiRssi, setWifiRssi] = useState(-54);
  const [lastSyncSeconds, setLastSyncSeconds] = useState(2);

  // 1. Sensor Ultrassônico (HC-SR04 - GPIO 5 TRIG / GPIO 18 ECHO)
  const [waterLevelPct, setWaterLevelPct] = useState(85);
  const [measuredDistanceCm, setMeasuredDistanceCm] = useState(null);

  // 2. Sensor de Temperatura (DS18B20 - GPIO 15)
  const [temperatureC, setTemperatureC] = useState(26.0);

  // 3. Histórico & Navegação
  const [logs, setLogs] = useState(INITIAL_LOGS);
  const [history, setHistory] = useState(INITIAL_HISTORY);
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard' | 'history' | 'hardware'

  // Cálculos físicos baseados nas medidas 25x13x18cm
  const waterColumnCm = ((waterLevelPct / 100) * MAX_COLUMN_CM).toFixed(1);
  const ultrasonicDistanceCm =
    measuredDistanceCm !== null
      ? Number(measuredDistanceCm).toFixed(1)
      : (TANK_HEIGHT_CM - Number(waterColumnCm)).toFixed(1);
  const waterVolumeLiters = (
    (TANK_LENGTH_CM * TANK_WIDTH_CM * Number(waterColumnCm)) /
    1000
  ).toFixed(2);
  const maxVolumeLiters = ((TANK_LENGTH_CM * TANK_WIDTH_CM * MAX_COLUMN_CM) / 1000).toFixed(2);

  // Status do Nível da Água
  const getWaterStatus = (pct) => {
    if (pct < 35)
      return {
        label: 'CRÍTICO — Repor Água',
        color: 'text-rose-400',
        bg: 'bg-rose-500/15 border-rose-500/40',
      };
    if (pct < 65)
      return {
        label: 'ATENÇÃO — Nível Baixo',
        color: 'text-amber-300',
        bg: 'bg-amber-500/15 border-amber-500/40',
      };
    if (pct > 95)
      return {
        label: 'ALERTA — Muito Cheio',
        color: 'text-amber-300',
        bg: 'bg-amber-500/15 border-amber-500/40',
      };
    return {
      label: 'IDEAL — Estável',
      color: 'text-emerald-300',
      bg: 'bg-emerald-500/15 border-emerald-400/30',
    };
  };

  // Status da Temperatura (DS18B20)
  const getTempStatus = (temp) => {
    if (temp < 22)
      return {
        label: 'BAIXA — Água Fria',
        color: 'text-sky-300',
        bg: 'bg-sky-500/15 border-sky-400/40',
      };
    if (temp > 29)
      return {
        label: 'ALTA — Água Quente',
        color: 'text-rose-400',
        bg: 'bg-rose-500/15 border-rose-500/40',
      };
    return {
      label: 'IDEAL (22°C – 29°C)',
      color: 'text-emerald-300',
      bg: 'bg-emerald-500/15 border-emerald-400/30',
    };
  };

  const waterStatus = getWaterStatus(waterLevelPct);
  const tempStatus = getTempStatus(temperatureC);

  // Texto exato das 2 linhas de 16 colunas do LCD 16x2 (0x27)
  const lcdLine0 = `Agua:${String(waterLevelPct).padStart(3, ' ')}% ${String(ultrasonicDistanceCm).padStart(4, ' ')}cm`;
  const lcdLine1 = `Temp:${temperatureC.toFixed(1).padStart(4, ' ')}C ${espOnline ? 'WiFi+' : 'Offln'}`;

  // Relógio de segundos desde o último sync
  useEffect(() => {
    if (!espOnline) return;
    const interval = setInterval(() => {
      setLastSyncSeconds((prev) => (prev >= 60 ? 1 : prev + 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [espOnline]);

  // Atualiza último ponto do gráfico quando nível ou temperatura mudam
  useEffect(() => {
    setHistory((prev) => {
      const copy = [...prev];
      copy[copy.length - 1] = {
        time: 'Agora',
        level: waterLevelPct,
        distance: Number(ultrasonicDistanceCm),
        temp: Number(temperatureC),
      };
      return copy;
    });
  }, [waterLevelPct, ultrasonicDistanceCm, temperatureC]);

  const formatLogTime = (isoStr) => {
    if (!isoStr) return 'Agora';
    const d = new Date(isoStr);
    return d.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  // Sincronização em Tempo Real com o Supabase
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;

    const loadInitialData = async () => {
      const { data: statusData } = await supabase
        .from('aquarium_status')
        .select('*')
        .eq('id', 1)
        .single();

      if (statusData) {
        if (statusData.water_level_pct !== undefined) setWaterLevelPct(statusData.water_level_pct);
        if (statusData.distance_cm !== undefined) setMeasuredDistanceCm(statusData.distance_cm);
        if (statusData.temperature_c !== undefined && statusData.temperature_c !== null) {
          setTemperatureC(Number(statusData.temperature_c));
        }
        if (statusData.wifi_rssi) setWifiRssi(statusData.wifi_rssi);
        if (statusData.esp_last_seen) {
          const diffSec = Math.floor(
            (Date.now() - new Date(statusData.esp_last_seen).getTime()) / 1000
          );
          setEspOnline(diffSec < 45);
          setLastSyncSeconds(Math.max(1, Math.min(diffSec, 59)));
        }
      }

      const { data: logData } = await supabase
        .from('telemetry_logs')
        .select('*')
        .order('recorded_at', { ascending: false })
        .limit(15);

      if (logData && logData.length > 0) {
        setLogs(
          logData.map((l) => ({
            id: l.id,
            time: formatLogTime(l.recorded_at),
            type: l.event_type,
            message: l.message,
            source: l.source,
          }))
        );
      }
    };

    loadInitialData();

    const channel = supabase
      .channel('netuno-web-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'aquarium_status' },
        (payload) => {
          const s = payload.new;
          if (!s) return;
          if (s.water_level_pct !== undefined) setWaterLevelPct(s.water_level_pct);
          if (s.distance_cm !== undefined) setMeasuredDistanceCm(s.distance_cm);
          if (s.temperature_c !== undefined && s.temperature_c !== null) {
            setTemperatureC(Number(s.temperature_c));
          }
          if (s.wifi_rssi) setWifiRssi(s.wifi_rssi);
          setLastSyncSeconds(0);
          setEspOnline(true);
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'telemetry_logs' },
        (payload) => {
          const l = payload.new;
          if (!l) return;
          setLogs((prev) => [
            {
              id: l.id,
              time: formatLogTime(l.recorded_at),
              type: l.event_type,
              message: l.message,
              source: l.source,
            },
            ...prev.slice(0, 14),
          ]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Salvar leitura manual no log do Supabase
  const handleSaveManualSnapshot = async () => {
    const message = `Leitura registrada: Água ${waterLevelPct}% (${ultrasonicDistanceCm} cm) • Temp: ${temperatureC.toFixed(1)} °C`;
    const now = new Date();
    const timeStr = now.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    if (!isSupabaseConfigured || !supabase) {
      setLogs((prev) => [
        { id: Date.now(), time: timeStr, type: 'sensor', message, source: 'Painel Web' },
        ...prev.slice(0, 14),
      ]);
      return;
    }

    await supabase.from('telemetry_logs').insert({
      event_type: 'sensor',
      water_level_pct: waterLevelPct,
      distance_cm: Number(ultrasonicDistanceCm),
      temperature_c: Number(temperatureC),
      message,
      source: 'Painel Web',
    });
  };

  return (
    <div className="min-h-screen flex flex-col text-slate-100 selection:bg-[#1A539B] selection:text-white">
      {/* ALERTA DE NÍVEL CRÍTICO SE < 35% */}
      {waterLevelPct < 35 && (
        <div className="bg-rose-600/90 backdrop-blur-md border-b border-rose-400/40 px-4 py-2.5 text-center text-sm font-medium text-white flex items-center justify-center gap-2 animate-pulse">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            <strong>Alerta do Sensor Ultrassônico:</strong> O nível da água está crítico (
            {waterLevelPct}% / {ultrasonicDistanceCm} cm do topo).
          </span>
        </div>
      )}

      {/* HEADER PRINCIPAL */}
      <header className="sticky top-0 z-30 border-b border-[#1A539B]/40 bg-[#06101E]/85 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="relative group">
              <div className="absolute -inset-1 rounded-2xl bg-gradient-to-tr from-[#1A539B] to-sky-400 opacity-60 blur group-hover:opacity-100 transition duration-300"></div>
              <div className="relative w-13 h-13 sm:w-14 sm:h-14 rounded-2xl overflow-hidden border-2 border-white/25 bg-[#1A539B] shadow-lg flex items-center justify-center">
                <img
                  src="/logo-netuno.jpg"
                  alt="Logo Netuno"
                  className="w-full h-full object-cover scale-105"
                />
              </div>
            </div>
            <div>
              <h1 className="font-serif text-2xl sm:text-3xl font-bold tracking-[0.16em] text-white drop-shadow-sm">
                NETUNO
              </h1>
              <p className="text-[11px] text-sky-300/80 hidden sm:block">
                Monitoramento do Aquário • 25 × 13 × 18 cm
              </p>
            </div>
          </div>

          {/* Navegação Central Enxuta */}
          <nav className="hidden md:flex items-center bg-[#0B1D35]/90 p-1 rounded-xl border border-[#1A539B]/40">
            {[
              { id: 'dashboard', label: 'Sensores & LCD', icon: Gauge },
              { id: 'history', label: 'Histórico & Logs', icon: TrendingUp },
              { id: 'hardware', label: 'Pinagem ESP32', icon: Cpu },
            ].map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-all ${
                    active
                      ? 'bg-[#1A539B] text-white shadow-md shadow-[#1A539B]/40 border border-sky-300/25'
                      : 'text-sky-200/70 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </nav>

          {/* Status de Conexão ESP32 */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setEspOnline(!espOnline)}
              title="Status de conexão do ESP32"
              className={`flex items-center gap-2.5 px-3.5 py-2 rounded-xl border text-xs font-medium transition-all ${
                espOnline
                  ? 'bg-[#0F2747]/90 border-emerald-400/30 text-emerald-200 hover:border-emerald-400/60'
                  : 'bg-rose-950/60 border-rose-500/40 text-rose-300 hover:bg-rose-900/50'
              }`}
            >
              <span className="relative flex h-2.5 w-2.5">
                {espOnline && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                )}
                <span
                  className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                    espOnline ? 'bg-emerald-400' : 'bg-rose-500'
                  }`}
                ></span>
              </span>
              <div className="text-left">
                <div className="font-semibold flex items-center gap-1.5">
                  {espOnline ? 'ESP32 Online' : 'ESP32 Offline'}
                  {espOnline ? (
                    <Wifi className="w-3.5 h-3.5 text-sky-300" />
                  ) : (
                    <WifiOff className="w-3.5 h-3.5 text-rose-400" />
                  )}
                </div>
                <div className="text-[10px] text-sky-200/60 hidden sm:block">
                  {espOnline
                    ? `Sync há ${lastSyncSeconds}s • ${wifiRssi} dBm`
                    : 'Sem resposta recente'}
                </div>
              </div>
            </button>
          </div>
        </div>

        {/* Navegação Mobile */}
        <div className="flex md:hidden border-t border-[#1A539B]/30 bg-[#081528] px-2 py-1.5 justify-around">
          {[
            { id: 'dashboard', label: 'Sensores & LCD', icon: Gauge },
            { id: 'history', label: 'Histórico', icon: TrendingUp },
            { id: 'hardware', label: 'Pinagem ESP32', icon: Cpu },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${
                  active ? 'bg-[#1A539B] text-white' : 'text-sky-200/70'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* CONTEÚDO PRINCIPAL */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-8">
        {/* RESUMO RÁPIDO DOS 4 INDICADORES ATUAIS */}
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-[#1A539B] via-[#15427E] to-[#0D284D] border border-sky-300/25 shadow-2xl shadow-[#06101E]/80 p-4 sm:p-5">
          <img
            src="/logo-netuno.jpg"
            alt=""
            aria-hidden="true"
            className="pointer-events-none select-none absolute -right-10 -bottom-14 w-60 h-60 object-contain opacity-15 mix-blend-screen rounded-full blur-[1px]"
          />

          <div className="relative z-10 grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {/* Card 1: Nível da Água */}
            <div className="bg-[#08172E]/65 backdrop-blur-md border border-white/15 rounded-2xl p-4 flex items-center justify-between">
              <div>
                <span className="text-[11px] uppercase tracking-wider text-sky-200/75 block">
                  Nível d'Água (HC-SR04)
                </span>
                <span className="text-2xl sm:text-3xl font-bold text-white mt-0.5 block">
                  {waterLevelPct}%
                </span>
                <span className="text-xs text-sky-300 font-mono-code">
                  Distância: {ultrasonicDistanceCm} cm
                </span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-[#1A539B]/60 border border-sky-300/25 flex items-center justify-center text-sky-200">
                <Waves className="w-5 h-5" />
              </div>
            </div>

            {/* Card 2: Temperatura */}
            <div className="bg-[#08172E]/65 backdrop-blur-md border border-white/15 rounded-2xl p-4 flex items-center justify-between">
              <div>
                <span className="text-[11px] uppercase tracking-wider text-sky-200/75 block">
                  Temperatura (DS18B20)
                </span>
                <span className="text-2xl sm:text-3xl font-bold text-emerald-300 mt-0.5 block">
                  {temperatureC.toFixed(1)} °C
                </span>
                <span className="text-xs text-sky-200/80">Porta GPIO 15</span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-[#1A539B]/60 border border-sky-300/25 flex items-center justify-center text-sky-200">
                <Thermometer className="w-5 h-5" />
              </div>
            </div>

            {/* Card 3: Display LCD 16x2 */}
            <div className="bg-[#08172E]/65 backdrop-blur-md border border-white/15 rounded-2xl p-4 flex items-center justify-between">
              <div>
                <span className="text-[11px] uppercase tracking-wider text-sky-200/75 block">
                  Display LCD 16x2
                </span>
                <span className="text-xl sm:text-2xl font-bold text-white mt-0.5 block font-mono-code">
                  I2C 0x27
                </span>
                <span className="text-xs text-sky-300">SDA 21 • SCL 22</span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-[#1A539B]/60 border border-sky-300/25 flex items-center justify-center text-sky-200">
                <Monitor className="w-5 h-5" />
              </div>
            </div>

            {/* Card 4: Banco de Dados Supabase */}
            <div className="bg-[#08172E]/65 backdrop-blur-md border border-white/15 rounded-2xl p-4 flex items-center justify-between">
              <div>
                <span className="text-[11px] uppercase tracking-wider text-sky-200/75 block">
                  Banco de Dados
                </span>
                <span className="text-2xl sm:text-3xl font-bold text-sky-300 mt-0.5 block">
                  Supabase
                </span>
                <span className="text-xs text-emerald-300">
                  {isSupabaseConfigured ? 'Realtime Ativo' : 'Modo Local'}
                </span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-[#1A539B]/60 border border-sky-300/25 flex items-center justify-center text-sky-200">
                <Database className="w-5 h-5" />
              </div>
            </div>
          </div>
        </section>

        {/* ===================================================================
            ABA 1: PAINEL DOS SENSORES ATIVOS (ULTRASSÔNICO + TEMP + LCD 16x2)
           =================================================================== */}
        {activeTab === 'dashboard' && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
              {/* COLUNA ESQUERDA (6 cols): SENSOR ULTRASSÔNICO HC-SR04 */}
              <div className="lg:col-span-6 bg-[#0B1D35]/90 backdrop-blur-xl rounded-3xl border border-[#1A539B]/50 p-6 flex flex-col justify-between shadow-xl">
                <div>
                  <div className="flex items-start justify-between gap-4 mb-5">
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-2xl bg-[#1A539B] border border-sky-300/30 flex items-center justify-center text-white shadow-inner">
                        <Waves className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-white">
                          Sensor Ultrassônico (HC-SR04)
                        </h3>
                        <p className="text-xs text-sky-200/70">
                          GPIO 5 (TRIG) & GPIO 18 (ECHO) • Aquário 25 × 13 × 18 cm
                        </p>
                      </div>
                    </div>

                    <span
                      className={`px-3 py-1 rounded-full text-xs font-semibold border ${waterStatus.bg} ${waterStatus.color}`}
                    >
                      {waterStatus.label}
                    </span>
                  </div>

                  {/* Visualização Gráfica do Aquário 25x13x18cm */}
                  <div className="relative h-64 rounded-2xl bg-gradient-to-b from-[#061121] to-[#091930] border-2 border-[#1A539B]/60 overflow-hidden shadow-inner mb-5">
                    {/* Sensor HC-SR04 no topo */}
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 z-20 bg-[#1A539B] border-x border-b border-sky-300/40 px-3 py-1 rounded-b-xl flex items-center gap-2 shadow-md">
                      <span className="w-2 h-2 rounded-full bg-sky-300 animate-ping"></span>
                      <span className="text-[10px] font-mono-code uppercase tracking-wider text-white font-semibold">
                        HC-SR04 • Distância: {ultrasonicDistanceCm} cm
                      </span>
                    </div>

                    {/* Feixe ultrassônico */}
                    <div
                      className="absolute top-6 left-1/2 -translate-x-1/2 w-16 border-x border-dashed border-sky-400/30 pointer-events-none transition-all duration-500"
                      style={{ height: `${Math.max(8, 100 - waterLevelPct)}%` }}
                    />

                    {/* Régua lateral proporcional aos 16 cm de coluna máxima (18 cm altura total) */}
                    <div className="absolute right-3 inset-y-4 z-20 flex flex-col justify-between text-[10px] font-mono-code text-sky-200/60 pointer-events-none">
                      <span>100% (16cm)</span>
                      <span>75% (12cm)</span>
                      <span>50% (8cm)</span>
                      <span>25% (4cm)</span>
                      <span>0% (0cm)</span>
                    </div>

                    {/* Água animada */}
                    <div
                      className="absolute bottom-0 inset-x-0 transition-all duration-700 ease-out"
                      style={{ height: `${waterLevelPct}%` }}
                    >
                      <div className="absolute -top-3 left-0 w-[200%] h-6 bg-[#1A539B]/80 rounded-[40%] animate-wave-slow"></div>
                      <div className="absolute -top-2 left-0 w-[200%] h-5 bg-sky-400/35 rounded-[45%] animate-wave-fast"></div>
                      <div className="w-full h-full bg-gradient-to-b from-[#1A539B]/85 via-[#154582]/90 to-[#0D2C56] relative overflow-hidden" />
                    </div>

                    {/* Indicador Central */}
                    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center pointer-events-none drop-shadow-md">
                      <span className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight">
                        {waterLevelPct}%
                      </span>
                      <span className="text-xs font-medium text-sky-100 bg-[#06101E]/65 px-3 py-0.5 rounded-full mt-1 border border-white/15">
                        Coluna d'água: {waterColumnCm} cm / {MAX_COLUMN_CM} cm ({waterVolumeLiters}{' '}
                        L)
                      </span>
                    </div>
                  </div>

                  {/* Métricas do Ultrassônico */}
                  <div className="grid grid-cols-3 gap-2.5 mb-4">
                    <div className="bg-[#06101E]/70 border border-[#1A539B]/40 rounded-xl p-3 text-center">
                      <span className="text-[11px] text-sky-200/70 block">Distância Topo</span>
                      <span className="text-base font-bold text-white font-mono-code">
                        {ultrasonicDistanceCm} cm
                      </span>
                    </div>
                    <div className="bg-[#06101E]/70 border border-[#1A539B]/40 rounded-xl p-3 text-center">
                      <span className="text-[11px] text-sky-200/70 block">Coluna d'Água</span>
                      <span className="text-base font-bold text-sky-300 font-mono-code">
                        {waterColumnCm} cm
                      </span>
                    </div>
                    <div className="bg-[#06101E]/70 border border-[#1A539B]/40 rounded-xl p-3 text-center">
                      <span className="text-[11px] text-sky-200/70 block">Volume Atual</span>
                      <span className="text-base font-bold text-white font-mono-code">
                        {waterVolumeLiters} / {maxVolumeLiters} L
                      </span>
                    </div>
                  </div>
                </div>

                {/* Controle de Teste de Nível */}
                <div className="bg-[#06101E]/90 border border-[#1A539B]/50 rounded-2xl p-3.5">
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="font-medium text-sky-200 flex items-center gap-1.5">
                      <Sliders className="w-3.5 h-3.5 text-sky-400" />
                      Testar leitura do nível na interface:
                    </span>
                    <span className="font-mono-code text-sky-300 font-semibold">
                      {waterLevelPct}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={waterLevelPct}
                    onChange={(e) => {
                      setMeasuredDistanceCm(null);
                      setWaterLevelPct(Number(e.target.value));
                    }}
                    className="w-full accent-sky-400 cursor-pointer h-2 bg-[#0F2747] rounded-lg"
                  />
                </div>
              </div>

              {/* COLUNA DIREITA (6 cols): DISPLAY LCD 16x2 I2C + SENSOR DE TEMPERATURA DS18B20 */}
              <div className="lg:col-span-6 flex flex-col gap-6">
                {/* CARD: ESPELHO EM TEMPO REAL DO DISPLAY LCD 16x2 I2C */}
                <div className="bg-[#0B1D35]/90 backdrop-blur-xl rounded-3xl border border-[#1A539B]/50 p-6 shadow-xl">
                  <div className="flex items-center justify-between gap-4 mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-2xl bg-[#1A539B] border border-sky-300/30 flex items-center justify-center text-white">
                        <Monitor className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-base font-bold text-white">Display LCD 16x2 I2C</h3>
                          <span className="text-[11px] font-mono-code px-2 py-0.5 rounded-md bg-[#06101E] text-sky-300 border border-[#1A539B]/50">
                            0x27 • SDA 21 / SCL 22
                          </span>
                        </div>
                        <p className="text-xs text-sky-200/70">
                          Espelho exato das 2 linhas de 16 caracteres exibidas no hardware
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Moldura física simulando o módulo LCD 1602 I2C azul/esverdeado */}
                  <div className="rounded-2xl bg-[#050D1A] border-2 border-[#1A539B]/70 p-4 shadow-inner">
                    <div className="rounded-xl bg-gradient-to-b from-[#0E3B2E] to-[#092920] border-2 border-emerald-400/40 px-5 py-4 shadow-[inset_0_0_24px_rgba(16,185,129,0.25)]">
                      <div className="font-mono-code text-xl sm:text-2xl font-bold tracking-[0.18em] text-emerald-200 drop-shadow-[0_0_8px_rgba(110,231,183,0.6)] whitespace-pre overflow-x-auto">
                        {lcdLine0}
                      </div>
                      <div className="font-mono-code text-xl sm:text-2xl font-bold tracking-[0.18em] text-emerald-200 drop-shadow-[0_0_8px_rgba(110,231,183,0.6)] whitespace-pre mt-1.5 overflow-x-auto">
                        {lcdLine1}
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-sky-200/60 mt-2.5 px-1">
                      <span>Biblioteca: LiquidCrystal_I2C.h + Wire.h</span>
                      <span className="font-mono-code">16 colunas × 2 linhas</span>
                    </div>
                  </div>
                </div>

                {/* CARD: SENSOR DE TEMPERATURA DS18B20 */}
                <div className="bg-[#0B1D35]/90 backdrop-blur-xl rounded-3xl border border-[#1A539B]/50 p-6 shadow-xl flex-1 flex flex-col justify-between">
                  <div>
                    <div className="flex items-start justify-between gap-4 mb-5">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-2xl bg-[#1A539B] border border-sky-300/30 flex items-center justify-center text-white">
                          <Thermometer className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-base font-bold text-white">
                              Sensor de Temperatura (DS18B20)
                            </h3>
                            <span className="text-[11px] font-mono-code px-2 py-0.5 rounded-md bg-[#06101E] text-sky-300 border border-[#1A539B]/50">
                              GPIO 15
                            </span>
                          </div>
                          <p className="text-xs text-sky-200/70">
                            Sonda à prova d'água • Bibliotecas OneWire.h + DallasTemperature.h
                          </p>
                        </div>
                      </div>

                      <span
                        className={`px-3 py-1 rounded-full text-xs font-semibold border ${tempStatus.bg} ${tempStatus.color}`}
                      >
                        {tempStatus.label}
                      </span>
                    </div>

                    {/* Mostrador Principal de Temperatura */}
                    <div className="bg-[#06101E]/80 border border-[#1A539B]/40 rounded-2xl p-5 mb-4 flex items-center justify-between">
                      <div>
                        <span className="text-xs text-sky-200/70 block">
                          Temperatura Atual da Água
                        </span>
                        <span className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight mt-1 block font-mono-code">
                          {temperatureC.toFixed(1)} °C
                        </span>
                      </div>
                      <div className="text-right text-xs text-sky-200/70 space-y-1">
                        <div>
                          Faixa Ideal:{' '}
                          <strong className="text-emerald-300 font-mono-code">22°C – 29°C</strong>
                        </div>
                        <div>
                          Fahrenheit:{' '}
                          <strong className="text-white font-mono-code">
                            {((temperatureC * 9) / 5 + 32).toFixed(1)} °F
                          </strong>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Controle para testar temperatura na UI */}
                  <div className="bg-[#06101E]/90 border border-[#1A539B]/50 rounded-2xl p-3.5">
                    <div className="flex items-center justify-between text-xs mb-2">
                      <span className="font-medium text-sky-200 flex items-center gap-1.5">
                        <Sliders className="w-3.5 h-3.5 text-sky-400" />
                        Testar leitura de temperatura na interface:
                      </span>
                      <span className="font-mono-code text-emerald-300 font-semibold">
                        {temperatureC.toFixed(1)} °C
                      </span>
                    </div>
                    <input
                      type="range"
                      min="15"
                      max="35"
                      step="0.5"
                      value={temperatureC}
                      onChange={(e) => setTemperatureC(Number(e.target.value))}
                      className="w-full accent-emerald-400 cursor-pointer h-2 bg-[#0F2747] rounded-lg"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* SEÇÃO INFERIOR: GRÁFICO E LOGS */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Gráfico de Nível e Temperatura (7 cols) */}
              <div className="lg:col-span-7 bg-[#0B1D35]/90 backdrop-blur-xl rounded-3xl border border-[#1A539B]/50 p-6 shadow-xl">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-sky-400" />
                      Histórico Recente (Nível & Temperatura)
                    </h3>
                    <p className="text-xs text-sky-200/70">
                      Leituras enviadas pelo ESP32 ao Supabase
                    </p>
                  </div>
                </div>

                <div className="h-48 flex items-end justify-between gap-3 pt-6 px-2 border-b border-[#1A539B]/40">
                  {history.map((point, idx) => {
                    const isLast = idx === history.length - 1;
                    return (
                      <div key={idx} className="flex-1 flex flex-col items-center gap-2 group">
                        <span className="text-[11px] font-mono-code text-sky-200">
                          {point.level}%
                        </span>
                        <div className="w-full max-w-[44px] h-32 bg-[#06101E] rounded-t-xl p-1 flex items-end border border-[#1A539B]/30">
                          <div
                            style={{ height: `${point.level}%` }}
                            className={`w-full rounded-t-lg transition-all duration-500 ${
                              isLast
                                ? 'bg-gradient-to-t from-[#1A539B] to-sky-400 shadow-lg shadow-sky-400/30'
                                : 'bg-gradient-to-t from-[#12396B] to-[#1A539B]'
                            }`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between px-2 pt-2.5 text-[11px] font-mono-code text-sky-200/70">
                  {history.map((point, idx) => (
                    <div key={idx} className="flex-1 text-center">
                      <div>{point.time}</div>
                      <div className="text-[10px] text-emerald-300/80">{point.temp}°C</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Logs Recentes do Supabase (5 cols) */}
              <div className="lg:col-span-5 bg-[#0B1D35]/90 backdrop-blur-xl rounded-3xl border border-[#1A539B]/50 p-6 shadow-xl flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-base font-bold text-white flex items-center gap-2">
                        <Activity className="w-4 h-4 text-sky-400" />
                        Últimas Leituras (Supabase)
                      </h3>
                      <p className="text-xs text-sky-200/70">Tabela `telemetry_logs`</p>
                    </div>
                    <button
                      onClick={() => setActiveTab('history')}
                      className="text-xs text-sky-300 hover:text-white flex items-center gap-1"
                    >
                      Ver todos <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                    {logs.slice(0, 5).map((log) => (
                      <div
                        key={log.id}
                        className="bg-[#06101E]/80 border border-[#1A539B]/35 rounded-2xl p-3 flex items-start gap-3"
                      >
                        <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 bg-sky-500/15 text-sky-300 border border-sky-400/30">
                          <Waves className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-white leading-snug">
                            {log.message}
                          </p>
                          <div className="flex items-center justify-between mt-1 text-[10px] text-sky-200/60">
                            <span>{log.source}</span>
                            <span className="font-mono-code">{log.time}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ===================================================================
            ABA 2: HISTÓRICO & LOGS DO SUPABASE
           =================================================================== */}
        {activeTab === 'history' && (
          <div className="bg-[#0B1D35]/90 backdrop-blur-xl rounded-3xl border border-[#1A539B]/50 p-6 sm:p-8 shadow-xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#1A539B]/40 pb-5">
              <div>
                <h3 className="text-xl font-bold text-white flex items-center gap-2.5">
                  <Database className="w-5 h-5 text-sky-400" />
                  Registros de Telemetria (Supabase)
                </h3>
                <p className="text-xs sm:text-sm text-sky-200/70 mt-1">
                  Histórico de leituras do sensor ultrassônico (HC-SR04) e temperatura (DS18B20).
                </p>
              </div>
              <button
                onClick={handleSaveManualSnapshot}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#1A539B] hover:bg-[#2364B8] text-xs font-semibold text-white border border-sky-300/30 transition"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Registrar Leitura Agora
              </button>
            </div>

            <div className="space-y-3">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="bg-[#06101E]/85 border border-[#1A539B]/40 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3.5">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-sky-500/15 text-sky-300 border border-sky-400/30">
                      <Waves className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">{log.message}</p>
                      <span className="text-xs text-sky-200/70">Origem: {log.source}</span>
                    </div>
                  </div>
                  <span className="text-xs font-mono-code text-sky-300 bg-[#0B1D35] px-3 py-1.5 rounded-lg border border-[#1A539B]/40 self-start sm:self-center">
                    {log.time}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ===================================================================
            ABA 3: PINAGEM ATUAL DO ESP32
           =================================================================== */}
        {activeTab === 'hardware' && (
          <div className="bg-[#0B1D35]/90 backdrop-blur-xl rounded-3xl border border-[#1A539B]/50 p-6 sm:p-8 shadow-xl space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-[#1A539B] border border-sky-300/30 flex items-center justify-center text-white">
                <Cpu className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">
                  Pinagem Ativa do ESP32 (Aquário 25 × 13 × 18 cm)
                </h3>
                <p className="text-xs text-sky-200/70">
                  Módulos configurados atualmente no arquivo `netuno_esp32.ino`
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-[#06101E]/85 border border-[#1A539B]/40 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-sky-300">1. LCD 16x2 I2C (0x27)</span>
                  <span className="text-xs font-mono-code bg-[#1A539B]/50 px-2.5 py-0.5 rounded text-white">
                    GPIO 21 / 22
                  </span>
                </div>
                <p className="text-xs text-sky-200/70">
                  Porta <strong>21 (SDA)</strong> e Porta <strong>22 (SCL)</strong> usando{' '}
                  <code>LiquidCrystal_I2C.h</code> e <code>Wire.h</code>.
                </p>
              </div>

              <div className="bg-[#06101E]/85 border border-[#1A539B]/40 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-sky-300">2. Ultrassônico HC-SR04</span>
                  <span className="text-xs font-mono-code bg-[#1A539B]/50 px-2.5 py-0.5 rounded text-white">
                    GPIO 5 / 18
                  </span>
                </div>
                <p className="text-xs text-sky-200/70">
                  Porta <strong>5 (TRIG)</strong> e Porta <strong>18 (ECHO)</strong> calibradas para
                  altura total de 18 cm (coluna útil de 16 cm).
                </p>
              </div>

              <div className="bg-[#06101E]/85 border border-[#1A539B]/40 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-emerald-300">3. Temperatura DS18B20</span>
                  <span className="text-xs font-mono-code bg-[#1A539B]/50 px-2.5 py-0.5 rounded text-white">
                    GPIO 15
                  </span>
                </div>
                <p className="text-xs text-sky-200/70">
                  Porta <strong>15 (OneWire)</strong> usando <code>OneWire.h</code> e{' '}
                  <code>DallasTemperature.h</code>.
                </p>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* RODAPÉ */}
      <footer className="border-t border-[#1A539B]/30 bg-[#06101E]/90 py-5 px-4 sm:px-6 lg:px-8 mt-8">
        <div className="max-w-7xl mx-auto flex items-center justify-center gap-2.5 text-xs text-sky-200/60">
          <img
            src="/logo-netuno.jpg"
            alt="Netuno"
            className="w-6 h-6 rounded-md object-cover border border-white/20"
          />
          <span className="font-serif font-bold tracking-widest text-white">NETUNO</span>
        </div>
      </footer>
    </div>
  );
}
