import React, { useState, useEffect } from 'react';
import {
  Waves,
  Wind,
  Utensils,
  Wifi,
  WifiOff,
  Activity,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Trash2,
  RefreshCw,
  Database,
  Cpu,
  Sliders,
  Sparkles,
  ChevronRight,
  Power,
  Timer,
  TrendingUp,
  Info,
  Bell,
  ShieldCheck,
  Gauge,
  Bluetooth,
  Smartphone
} from 'lucide-react';
import { supabase, isSupabaseConfigured } from './lib/supabase';
import MobileApkSimulator from './components/MobileApkSimulator';

// Dados iniciais simulados do histórico (como viriam da tabela `telemetry_logs` do Supabase)
const INITIAL_WATER_HISTORY = [
  { time: '00:00', level: 88, distance: 7.4 },
  { time: '04:00', level: 87, distance: 7.6 },
  { time: '08:00', level: 86, distance: 7.9 },
  { time: '12:00', level: 84, distance: 8.4 },
  { time: '16:00', level: 83, distance: 8.6 },
  { time: '20:00', level: 85, distance: 8.1 },
  { time: 'Agora', level: 85, distance: 8.1 },
];

const INITIAL_SCHEDULES = [
  { id: 1, time: '08:00', portion: 'Padrão (5g)', enabled: true, label: 'Manhã' },
  { id: 2, time: '14:00', portion: 'Leve (3g)', enabled: true, label: 'Tarde' },
  { id: 3, time: '20:00', portion: 'Padrão (5g)', enabled: true, label: 'Noite' },
];

const INITIAL_LOGS = [
  { id: 101, time: 'Hoje, 08:00', type: 'feeder', message: 'Alimentador acionado automaticamente (Porção: 5g)', source: 'Agendamento ESP32' },
  { id: 102, time: 'Hoje, 07:45', type: 'sensor', message: 'Leitura HC-SR04 estabilizada: 8.1 cm do topo (85%)', source: 'Sensor Ultrassônico' },
  { id: 103, time: 'Hoje, 06:00', type: 'pump', message: 'Relé da Bomba de Oxigênio ativado (Ciclo Matinal)', source: 'Automação Relé' },
  { id: 104, time: 'Ontem, 20:00', type: 'feeder', message: 'Alimentador acionado automaticamente (Porção: 5g)', source: 'Agendamento ESP32' },
];

export default function App() {
  // Estados principais dos sensores e atuadores do ESP32
  const [espOnline, setEspOnline] = useState(true);
  const [wifiRssi, setWifiRssi] = useState(-54);
  const [lastSyncSeconds, setLastSyncSeconds] = useState(2);

  // Sensor Ultrassônico (HC-SR04)
  // Altura total do aquário: 40cm. Sensor fica no topo: distância menor = mais água.
  const TANK_HEIGHT_CM = 40;
  const SENSOR_OFFSET_CM = 2; // margem do sensor até nível 100%
  const [waterLevelPct, setWaterLevelPct] = useState(85);
  const [isSimulatingSensor, setIsSimulatingSensor] = useState(false);

  // Bomba de Oxigênio (Módulo Relé)
  const [pumpActive, setPumpActive] = useState(true);
  const [pumpMode, setPumpMode] = useState('auto'); // 'manual' | 'auto'
  const [pumpCycleMinutes, setPumpCycleMinutes] = useState(45); // 45 min ligado / 15 min pausa

  // Alimentador Automático (Servo Motor)
  const [isFeeding, setIsFeeding] = useState(false);
  const [selectedPortion, setSelectedPortion] = useState('Padrão (5g)');
  const [schedules, setSchedules] = useState(INITIAL_SCHEDULES);
  const [newScheduleTime, setNewScheduleTime] = useState('18:00');
  const [newSchedulePortion, setNewSchedulePortion] = useState('Padrão (5g)');
  const [feedCountToday, setFeedCountToday] = useState(2);

  // Logs & Histórico (Supabase Mock)
  const [logs, setLogs] = useState(INITIAL_LOGS);
  const [waterHistory, setWaterHistory] = useState(INITIAL_WATER_HISTORY);
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard' | 'history' | 'hardware'

  // Cálculo da distância em cm do sensor ultrassônico a partir da % de água
  const waterColumnCm = ((waterLevelPct / 100) * (TANK_HEIGHT_CM - SENSOR_OFFSET_CM)).toFixed(1);
  const ultrasonicDistanceCm = (TANK_HEIGHT_CM - waterColumnCm).toFixed(1);

  // Status de segurança do nível de água
  const getWaterStatus = (pct) => {
    if (pct < 40) return { label: 'CRÍTICO — Repor Água', color: 'text-rose-400', bg: 'bg-rose-500/15 border-rose-500/40', badge: 'bg-rose-500' };
    if (pct < 65) return { label: 'ATENÇÃO — Nível Baixo', color: 'text-amber-300', bg: 'bg-amber-500/15 border-amber-500/40', badge: 'bg-amber-400' };
    if (pct > 95) return { label: 'ALERTA — Risco de Transbordo', color: 'text-amber-300', bg: 'bg-amber-500/15 border-amber-500/40', badge: 'bg-amber-400' };
    return { label: 'IDEAL — Estável', color: 'text-sky-300', bg: 'bg-sky-500/15 border-sky-400/30', badge: 'bg-emerald-400' };
  };

  const waterStatus = getWaterStatus(waterLevelPct);

  // Contador de sincronização com ESP32 / Supabase
  useEffect(() => {
    if (!espOnline) return;
    const interval = setInterval(() => {
      setLastSyncSeconds((prev) => (prev >= 10 ? 1 : prev + 1));
      // Pequena variação realista de sinal Wi-Fi
      if (Math.random() > 0.7) {
        setWifiRssi(-52 - Math.floor(Math.random() * 6));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [espOnline]);

  // Atualiza último ponto do gráfico quando o usuário muda o nível da água
  useEffect(() => {
    setWaterHistory((prev) => {
      const copy = [...prev];
      copy[copy.length - 1] = {
        time: 'Agora',
        level: waterLevelPct,
        distance: Number(ultrasonicDistanceCm),
      };
      return copy;
    });
  }, [waterLevelPct, ultrasonicDistanceCm]);

  // Função para formatar data/hora vinda do Supabase
  const formatLogTime = (isoStr) => {
    if (!isoStr) return 'Agora';
    const d = new Date(isoStr);
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  // Integração Real com Supabase (quando VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY estiverem configuradas)
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;

    const loadInitialData = async () => {
      const { data: statusData } = await supabase
        .from('aquarium_status')
        .select('*')
        .eq('id', 1)
        .single();

      if (statusData) {
        setWaterLevelPct(statusData.water_level_pct);
        setPumpActive(statusData.pump_relay_on);
        setPumpMode(statusData.pump_mode || 'auto');
        if (statusData.pump_cycle_minutes) setPumpCycleMinutes(statusData.pump_cycle_minutes);
        if (statusData.wifi_rssi) setWifiRssi(statusData.wifi_rssi);
        if (statusData.esp_last_seen) {
          const diffSec = Math.floor((Date.now() - new Date(statusData.esp_last_seen).getTime()) / 1000);
          setEspOnline(diffSec < 30);
        }
      }

      const { data: schedData } = await supabase
        .from('feed_schedules')
        .select('*')
        .order('time', { ascending: true });
      if (schedData && schedData.length > 0) setSchedules(schedData);

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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'aquarium_status' }, (payload) => {
        const s = payload.new;
        if (!s) return;
        setWaterLevelPct(s.water_level_pct);
        setPumpActive(s.pump_relay_on);
        if (s.pump_mode) setPumpMode(s.pump_mode);
        if (s.wifi_rssi) setWifiRssi(s.wifi_rssi);
        setLastSyncSeconds(0);
        setEspOnline(true);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'telemetry_logs' }, (payload) => {
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
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Função para adicionar log de eventos (Local + Supabase se configurado)
  const addLog = async (type, message, source) => {
    const now = new Date();
    const timeStr = `Hoje, ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    if (!isSupabaseConfigured) {
      setLogs((prev) => [
        { id: Date.now(), time: timeStr, type, message, source },
        ...prev.slice(0, 14),
      ]);
      return;
    }
    await supabase.from('telemetry_logs').insert({
      event_type: type,
      water_level_pct: waterLevelPct,
      distance_cm: Number(ultrasonicDistanceCm),
      message,
      source,
    });
  };

  // Alternar Relé da Bomba de Oxigênio
  const handleTogglePump = async (fromApk = false) => {
    if (!espOnline && !fromApk) return;
    const nextState = !pumpActive;
    setPumpActive(nextState);
    setLastSyncSeconds(0);
    if (isSupabaseConfigured && supabase && espOnline) {
      await supabase.from('aquarium_status').update({ pump_relay_on: nextState }).eq('id', 1);
    }
    addLog(
      'pump',
      `Relé da Bomba de Oxigênio ${nextState ? 'LIGADO' : 'DESLIGADO'} manualmente`,
      fromApk ? (espOnline ? 'APK Wi-Fi → Supabase' : 'APK Bluetooth → ESP32') : 'Controle Remoto Web'
    );
  };

  // Acionar Alimentador Automático Agora
  const handleFeedNow = async (fromApk = false) => {
    if (isFeeding || (!espOnline && !fromApk)) return;
    setIsFeeding(true);
    setLastSyncSeconds(0);
    setFeedCountToday((c) => c + 1);
    if (isSupabaseConfigured && supabase && espOnline) {
      await supabase
        .from('aquarium_status')
        .update({ feed_now_command: true, feed_now_portion: selectedPortion })
        .eq('id', 1);
    }
    addLog(
      'feeder',
      `Alimentação manual disparada (${selectedPortion})`,
      fromApk ? (espOnline ? 'APK Wi-Fi → Supabase' : 'APK Bluetooth → ESP32') : 'Painel Netuno → ESP32'
    );
    setTimeout(() => {
      setIsFeeding(false);
    }, 2600);
  };

  // Adicionar novo horário de alimentação
  const handleAddSchedule = async (e) => {
    e.preventDefault();
    if (!newScheduleTime) return;
    if (isSupabaseConfigured && supabase) {
      const { data } = await supabase
        .from('feed_schedules')
        .insert({ time: newScheduleTime, portion: newSchedulePortion, enabled: true, label: 'Personalizado' })
        .select()
        .single();
      if (data) {
        setSchedules((prev) => [...prev, data].sort((a, b) => a.time.localeCompare(b.time)));
      }
    } else {
      const newItem = {
        id: Date.now(),
        time: newScheduleTime,
        portion: newSchedulePortion,
        enabled: true,
        label: 'Personalizado',
      };
      setSchedules((prev) => [...prev, newItem].sort((a, b) => a.time.localeCompare(b.time)));
    }
    addLog('feeder', `Novo agendamento salvo no Supabase: ${newScheduleTime} (${newSchedulePortion})`, 'Configuração');
  };

  const handleToggleSchedule = async (id) => {
    const target = schedules.find((s) => s.id === id);
    if (!target) return;
    const nextEnabled = !target.enabled;
    setSchedules((prev) =>
      prev.map((item) => (item.id === id ? { ...item, enabled: nextEnabled } : item))
    );
    if (isSupabaseConfigured && supabase) {
      await supabase.from('feed_schedules').update({ enabled: nextEnabled }).eq('id', id);
    }
  };

  const handleDeleteSchedule = async (id) => {
    setSchedules((prev) => prev.filter((item) => item.id !== id));
    if (isSupabaseConfigured && supabase) {
      await supabase.from('feed_schedules').delete().eq('id', id);
    }
  };

  return (
    <div className="min-h-screen flex flex-col text-slate-100 selection:bg-[#1A539B] selection:text-white">
      {/* BARRA DE ALERTA DE NÍVEL CRÍTICO SE < 40% */}
      {waterLevelPct < 40 && (
        <div className="bg-rose-600/90 backdrop-blur-md border-b border-rose-400/40 px-4 py-2.5 text-center text-sm font-medium text-white flex items-center justify-center gap-2 animate-pulse">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            <strong>Alerta do Sensor Ultrassônico:</strong> O nível da água está crítico ({waterLevelPct}% / {ultrasonicDistanceCm} cm do topo). Verifique evaporação ou vazamentos antes de manter a bomba ativa!
          </span>
        </div>
      )}

      {/* HEADER PRINCIPAL COM A LOGO NETUNO */}
      <header className="sticky top-0 z-30 border-b border-[#1A539B]/40 bg-[#06101E]/85 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between gap-4">
          {/* Identidade Visual Netuno */}
          <div className="flex items-center gap-4">
            <div className="relative group">
              <div className="absolute -inset-1 rounded-2xl bg-gradient-to-tr from-[#1A539B] to-sky-400 opacity-60 blur group-hover:opacity-100 transition duration-300"></div>
              <div className="relative w-13 h-13 sm:w-14 sm:h-14 rounded-2xl overflow-hidden border-2 border-white/25 bg-[#1A539B] shadow-lg flex items-center justify-center">
                <img
                  src="/logo-netuno.jpg"
                  alt="Logo Netuno Carpas"
                  className="w-full h-full object-cover scale-105"
                />
              </div>
            </div>
            <div>
              <h1 className="font-serif text-2xl sm:text-3xl font-bold tracking-[0.16em] text-white drop-shadow-sm">
                NETUNO
              </h1>
            </div>
          </div>

          {/* Navegação Central */}
          <nav className="hidden md:flex items-center bg-[#0B1D35]/90 p-1 rounded-xl border border-[#1A539B]/40">
            {[
              { id: 'dashboard', label: 'Painel de Controle', icon: Gauge },
              { id: 'apk-preview', label: 'Simulador do .APK', icon: Smartphone },
              { id: 'history', label: 'Histórico & Logs', icon: TrendingUp },
              { id: 'hardware', label: 'Topologia ESP32', icon: Cpu },
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

          {/* Status de Conexão ESP32 & Supabase */}
          <div className="flex items-center gap-3">
            {/* Botão para simular queda/retorno do ESP32 */}
            <button
              onClick={() => setEspOnline(!espOnline)}
              title="Clique para simular ESP32 Online/Offline"
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
                  {espOnline ? <Wifi className="w-3.5 h-3.5 text-sky-300" /> : <WifiOff className="w-3.5 h-3.5 text-rose-400" />}
                </div>
                <div className="text-[10px] text-sky-200/60 hidden sm:block">
                  {espOnline ? `Sync há ${lastSyncSeconds}s • ${wifiRssi} dBm` : 'Sem resposta do microcontrolador'}
                </div>
              </div>
            </button>
          </div>
        </div>

        {/* Navegação Mobile */}
        <div className="flex md:hidden border-t border-[#1A539B]/30 bg-[#081528] px-2 py-1.5 justify-around">
          {[
            { id: 'dashboard', label: 'Painel', icon: Gauge },
            { id: 'apk-preview', label: 'App .APK', icon: Smartphone },
            { id: 'history', label: 'Histórico', icon: TrendingUp },
            { id: 'hardware', label: 'ESP32', icon: Cpu },
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
        {/* BARRA DE INDICADORES RÁPIDOS */}
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-[#1A539B] via-[#15427E] to-[#0D284D] border border-sky-300/25 shadow-2xl shadow-[#06101E]/80 p-4 sm:p-5">
          {/* Marca d'água sutil da logo ao fundo */}
          <img
            src="/logo-netuno.jpg"
            alt=""
            aria-hidden="true"
            className="pointer-events-none select-none absolute -right-10 -bottom-14 w-60 h-60 object-contain opacity-15 mix-blend-screen rounded-full blur-[1px]"
          />

          <div className="relative z-10 grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <div className="bg-[#08172E]/65 backdrop-blur-md border border-white/15 rounded-2xl p-4 flex items-center justify-between">
              <div>
                <span className="text-[11px] uppercase tracking-wider text-sky-200/75 block">Nível d'Água</span>
                <span className="text-2xl sm:text-3xl font-bold text-white mt-0.5 block">{waterLevelPct}%</span>
                <span className="text-xs text-sky-300 font-mono-code">{ultrasonicDistanceCm} cm do sensor</span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-[#1A539B]/60 border border-sky-300/25 flex items-center justify-center text-sky-200">
                <Waves className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-[#08172E]/65 backdrop-blur-md border border-white/15 rounded-2xl p-4 flex items-center justify-between">
              <div>
                <span className="text-[11px] uppercase tracking-wider text-sky-200/75 block">Oxigenação</span>
                <span className={`text-2xl sm:text-3xl font-bold mt-0.5 block ${pumpActive ? 'text-emerald-300' : 'text-amber-300'}`}>
                  {pumpActive ? 'Ativa' : 'Pausada'}
                </span>
                <span className="text-xs text-sky-200/80">Relé: {pumpMode === 'auto' ? 'Automático' : 'Manual'}</span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-[#1A539B]/60 border border-sky-300/25 flex items-center justify-center text-sky-200">
                <Wind className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-[#08172E]/65 backdrop-blur-md border border-white/15 rounded-2xl p-4 flex items-center justify-between">
              <div>
                <span className="text-[11px] uppercase tracking-wider text-sky-200/75 block">Alimentações</span>
                <span className="text-2xl sm:text-3xl font-bold text-white mt-0.5 block">{feedCountToday}x hoje</span>
                <span className="text-xs text-sky-300">Próx: 20:00</span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-[#1A539B]/60 border border-sky-300/25 flex items-center justify-center text-sky-200">
                <Utensils className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-[#08172E]/65 backdrop-blur-md border border-white/15 rounded-2xl p-4 flex items-center justify-between">
              <div>
                <span className="text-[11px] uppercase tracking-wider text-sky-200/75 block">Banco de Dados</span>
                <span className="text-2xl sm:text-3xl font-bold text-sky-300 mt-0.5 block">
                  Supabase
                </span>
                <span className="text-xs text-emerald-300">
                  {isSupabaseConfigured ? 'Realtime Conectado' : 'Modo Simulação Base'}
                </span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-[#1A539B]/60 border border-sky-300/25 flex items-center justify-center text-sky-200">
                <Database className="w-5 h-5" />
              </div>
            </div>
          </div>
        </section>

        {/* ===================================================================
            ABA 1: PAINEL DE CONTROLE PRINCIPAL (OS 3 PILARES DO AQUÁRIO)
           =================================================================== */}
        {activeTab === 'dashboard' && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
              {/* COLUNA 1 (5 cols): MONITOR DE NÍVEL DA ÁGUA (SENSOR ULTRASSÔNICO) */}
              <div className="lg:col-span-5 bg-[#0B1D35]/90 backdrop-blur-xl rounded-3xl border border-[#1A539B]/50 p-6 flex flex-col justify-between shadow-xl">
                <div>
                  {/* Cabeçalho do Card */}
                  <div className="flex items-start justify-between gap-4 mb-5">
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-2xl bg-[#1A539B] border border-sky-300/30 flex items-center justify-center text-white shadow-inner">
                        <Waves className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-white">Nível da Água</h3>
                        <p className="text-xs text-sky-200/70">Sensor Ultrassônico HC-SR04</p>
                      </div>
                    </div>

                    <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${waterStatus.bg} ${waterStatus.color}`}>
                      {waterStatus.label}
                    </span>
                  </div>

                  {/* Visualização Gráfica do Aquário Animado */}
                  <div className="relative h-64 rounded-2xl bg-gradient-to-b from-[#061121] to-[#091930] border-2 border-[#1A539B]/60 overflow-hidden shadow-inner mb-5">
                    {/* Ícone do Sensor Ultrassônico no topo do aquário */}
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 z-20 bg-[#1A539B] border-x border-b border-sky-300/40 px-3 py-1 rounded-b-xl flex items-center gap-2 shadow-md">
                      <span className="w-2 h-2 rounded-full bg-sky-300 animate-ping"></span>
                      <span className="text-[10px] font-mono-code uppercase tracking-wider text-white font-semibold">
                        HC-SR04 • Distância: {ultrasonicDistanceCm} cm
                      </span>
                    </div>

                    {/* Linhas tracejadas de feixe ultrassônico */}
                    <div
                      className="absolute top-6 left-1/2 -translate-x-1/2 w-16 border-x border-dashed border-sky-400/30 pointer-events-none transition-all duration-500"
                      style={{ height: `${Math.max(8, 100 - waterLevelPct)}%` }}
                    />

                    {/* Régua lateral de medição */}
                    <div className="absolute right-3 inset-y-4 z-20 flex flex-col justify-between text-[10px] font-mono-code text-sky-200/60 pointer-events-none">
                      <span>100% (38cm)</span>
                      <span>75% (28cm)</span>
                      <span>50% (19cm)</span>
                      <span>25% (9cm)</span>
                      <span>0% (0cm)</span>
                    </div>

                    {/* Partículas de ração caindo quando alimentador é acionado */}
                    {isFeeding && (
                      <div className="absolute top-6 left-1/3 z-30 flex gap-2">
                        {[0, 1, 2, 3, 4].map((i) => (
                          <span
                            key={i}
                            style={{ animationDelay: `${i * 0.18}s` }}
                            className="food-pellet w-2.5 h-2.5 rounded-full bg-amber-400 shadow-md shadow-amber-500/50 block"
                          />
                        ))}
                      </div>
                    )}

                    {/* Água com ondas e cor inspirada na logo (#1A539B) */}
                    <div
                      className="absolute bottom-0 inset-x-0 transition-all duration-700 ease-out"
                      style={{ height: `${waterLevelPct}%` }}
                    >
                      {/* Onda superior animada */}
                      <div className="absolute -top-3 left-0 w-[200%] h-6 bg-[#1A539B]/80 rounded-[40%] animate-wave-slow"></div>
                      <div className="absolute -top-2 left-0 w-[200%] h-5 bg-sky-400/35 rounded-[45%] animate-wave-fast"></div>

                      {/* Corpo da água */}
                      <div className="w-full h-full bg-gradient-to-b from-[#1A539B]/85 via-[#154582]/90 to-[#0D2C56] relative overflow-hidden">
                        {/* Bolhas subindo se a bomba de oxigênio estiver ligada */}
                        {pumpActive && espOnline && (
                          <div className="absolute inset-0 pointer-events-none">
                            {[
                              { left: '14%', size: 'w-2 h-2', duration: '3.2s', delay: '0s' },
                              { left: '22%', size: 'w-3 h-3', duration: '4.1s', delay: '0.8s' },
                              { left: '18%', size: 'w-1.5 h-1.5', duration: '2.7s', delay: '1.4s' },
                              { left: '28%', size: 'w-2.5 h-2.5', duration: '3.8s', delay: '0.4s' },
                              { left: '12%', size: 'w-2 h-2', duration: '3.5s', delay: '2.1s' },
                            ].map((b, idx) => (
                              <span
                                key={idx}
                                style={{
                                  left: b.left,
                                  '--duration': b.duration,
                                  '--delay': b.delay,
                                }}
                                className={`bubble absolute bottom-2 ${b.size} rounded-full bg-sky-200/70 border border-white/60`}
                              />
                            ))}
                          </div>
                        )}

                        {/* Pedra porosa de oxigênio no canto esquerdo inferior */}
                        <div className="absolute bottom-2 left-4 flex items-center gap-1.5 bg-[#06101E]/70 px-2.5 py-1 rounded-lg border border-sky-300/25">
                          <Wind className={`w-3.5 h-3.5 ${pumpActive ? 'text-sky-300 animate-spin' : 'text-slate-500'}`} style={{ animationDuration: '4s' }} />
                          <span className="text-[10px] text-sky-100/90 font-medium">
                            {pumpActive ? 'Oxigenando' : 'Bomba Off'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Valor Central em Destaque */}
                    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center pointer-events-none drop-shadow-md">
                      <span className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight">
                        {waterLevelPct}%
                      </span>
                      <span className="text-xs font-medium text-sky-100 bg-[#06101E]/60 px-2.5 py-0.5 rounded-full mt-1 border border-white/15">
                        Coluna d'água: {waterColumnCm} cm / {TANK_HEIGHT_CM} cm
                      </span>
                    </div>
                  </div>

                  {/* Métricas Técnicas do Sensor Ultrassônico */}
                  <div className="grid grid-cols-3 gap-2.5 mb-4">
                    <div className="bg-[#06101E]/70 border border-[#1A539B]/40 rounded-xl p-3 text-center">
                      <span className="text-[11px] text-sky-200/70 block">Distância Topo</span>
                      <span className="text-base font-bold text-white font-mono-code">{ultrasonicDistanceCm} cm</span>
                    </div>
                    <div className="bg-[#06101E]/70 border border-[#1A539B]/40 rounded-xl p-3 text-center">
                      <span className="text-[11px] text-sky-200/70 block">Coluna d'Água</span>
                      <span className="text-base font-bold text-sky-300 font-mono-code">{waterColumnCm} cm</span>
                    </div>
                    <div className="bg-[#06101E]/70 border border-[#1A539B]/40 rounded-xl p-3 text-center">
                      <span className="text-[11px] text-sky-200/70 block">Volume Estimado</span>
                      <span className="text-base font-bold text-white font-mono-code">{Math.round((waterLevelPct / 100) * 120)} L</span>
                    </div>
                  </div>
                </div>

                {/* Simulador Interativo do Sensor Ultrassônico (Para testar a UI!) */}
                <div className="bg-[#06101E]/90 border border-[#1A539B]/50 rounded-2xl p-3.5">
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="font-medium text-sky-200 flex items-center gap-1.5">
                      <Sliders className="w-3.5 h-3.5 text-sky-400" />
                      Simular leitura do Sensor Ultrassônico:
                    </span>
                    <span className="font-mono-code text-sky-300 font-semibold">{waterLevelPct}%</span>
                  </div>
                  <input
                    type="range"
                    min="15"
                    max="98"
                    value={waterLevelPct}
                    onChange={(e) => {
                      setWaterLevelPct(Number(e.target.value));
                      setIsSimulatingSensor(true);
                    }}
                    className="w-full accent-sky-400 cursor-pointer h-2 bg-[#0F2747] rounded-lg"
                  />
                  <div className="flex justify-between text-[10px] text-sky-200/50 mt-1">
                    <span>15% (Crítico)</span>
                    <span>55% (Atenção)</span>
                    <span>85% (Ideal)</span>
                    <span>98% (Cheio)</span>
                  </div>
                </div>
              </div>

              {/* COLUNA 2 (7 cols): BOMBA DE OXIGÊNIO (RELÉ) + ALIMENTADOR AUTOMÁTICO */}
              <div className="lg:col-span-7 flex flex-col gap-6">
                {/* CARD 2: CONTROLE DA BOMBA DE OXIGÊNIO (MÓDULO RELÉ) */}
                <div className="bg-[#0B1D35]/90 backdrop-blur-xl rounded-3xl border border-[#1A539B]/50 p-6 shadow-xl">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-[#1A539B]/30">
                    <div className="flex items-center gap-3.5">
                      <div
                        className={`w-12 h-12 rounded-2xl flex items-center justify-center border transition-all ${
                          pumpActive
                            ? 'bg-[#1A539B] border-sky-300/50 text-white shadow-lg shadow-[#1A539B]/50'
                            : 'bg-[#06101E] border-slate-700 text-slate-400'
                        }`}
                      >
                        <Wind className="w-6 h-6" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-base sm:text-lg font-bold text-white">
                            Bomba de Oxigênio
                          </h3>
                          <span className="text-[11px] font-mono-code px-2 py-0.5 rounded-md bg-[#06101E] text-sky-300 border border-[#1A539B]/50">
                            Relé GPIO 26
                          </span>
                        </div>
                        <p className="text-xs text-sky-200/70">
                          Acionamento por Módulo Relé 5V • Controle de oxigenação e circulação
                        </p>
                      </div>
                    </div>

                    {/* Botão Principal Liga / Desliga Relé */}
                    <button
                      onClick={handleTogglePump}
                      disabled={!espOnline}
                      className={`flex items-center justify-center gap-2.5 px-5 py-3 rounded-2xl font-semibold text-sm transition-all shadow-lg ${
                        !espOnline
                          ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                          : pumpActive
                          ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-500/20'
                          : 'bg-[#1A539B] hover:bg-[#2364B8] text-white border border-sky-300/30 shadow-[#1A539B]/40'
                      }`}
                    >
                      <Power className="w-4 h-4" />
                      <span>{pumpActive ? 'Relé Ativado (Desligar)' : 'Ligar Bomba Agora'}</span>
                    </button>
                  </div>

                  {/* Modos de Operação do Relé */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-5">
                    {/* Seleção Manual vs Automático */}
                    <div className="bg-[#06101E]/75 border border-[#1A539B]/40 rounded-2xl p-4 flex flex-col justify-between">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-semibold text-sky-200 flex items-center gap-1.5">
                          <Timer className="w-4 h-4 text-sky-400" />
                          Modo de Operação do Relé
                        </span>
                        <span className="text-[11px] text-sky-300/80 font-mono-code">
                          {pumpMode === 'auto' ? 'Ciclo Inteligente' : 'Controle Fixo'}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 bg-[#0B1D35] p-1 rounded-xl border border-[#1A539B]/30">
                        <button
                          onClick={() => setPumpMode('auto')}
                          className={`py-2 px-3 rounded-lg text-xs font-semibold transition-all ${
                            pumpMode === 'auto'
                              ? 'bg-[#1A539B] text-white shadow'
                              : 'text-sky-200/70 hover:text-white'
                          }`}
                        >
                          Automático
                        </button>
                        <button
                          onClick={() => setPumpMode('manual')}
                          className={`py-2 px-3 rounded-lg text-xs font-semibold transition-all ${
                            pumpMode === 'manual'
                              ? 'bg-[#1A539B] text-white shadow'
                              : 'text-sky-200/70 hover:text-white'
                          }`}
                        >
                          Manual Fixo
                        </button>
                      </div>

                      <p className="text-[11px] text-sky-200/60 mt-3">
                        {pumpMode === 'auto'
                          ? `Alterna o relé automaticamente (${pumpCycleMinutes} min ligado / ${60 - pumpCycleMinutes} min descanso) para preservar a bomba.`
                          : 'O relé permanece no estado atual até que você altere manualmente no painel.'}
                      </p>
                    </div>

                    {/* Status e Proteção do Relé */}
                    <div className="bg-[#06101E]/75 border border-[#1A539B]/40 rounded-2xl p-4 flex flex-col justify-between">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-sky-200 flex items-center gap-1.5">
                          <ShieldCheck className="w-4 h-4 text-emerald-400" />
                          Diagnóstico do Módulo Relé
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
                            pumpActive ? 'text-emerald-300' : 'text-amber-300'
                          }`}
                        >
                          <span className={`w-2 h-2 rounded-full ${pumpActive ? 'bg-emerald-400 animate-ping' : 'bg-amber-400'}`} />
                          {pumpActive ? 'Contato Fechado (ON)' : 'Contato Aberto (OFF)'}
                        </span>
                      </div>

                      <div className="space-y-2 text-xs my-1">
                        <div className="flex justify-between text-sky-200/75">
                          <span>Tempo ativo por hora:</span>
                          <span className="font-mono-code text-white font-semibold">{pumpCycleMinutes} min / h</span>
                        </div>
                        <input
                          type="range"
                          min="15"
                          max="60"
                          step="5"
                          disabled={pumpMode !== 'auto'}
                          value={pumpCycleMinutes}
                          onChange={(e) => setPumpCycleMinutes(Number(e.target.value))}
                          className="w-full accent-sky-400 cursor-pointer h-1.5 bg-[#0F2747] rounded-lg disabled:opacity-40"
                        />
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-sky-200/60 pt-2 border-t border-white/5">
                        <span>Proteção contra nível crítico (&lt;30%):</span>
                        <span className="text-emerald-300 font-medium">Ativa</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* CARD 3: ALIMENTADOR AUTOMÁTICO */}
                <div className="bg-[#0B1D35]/90 backdrop-blur-xl rounded-3xl border border-[#1A539B]/50 p-6 shadow-xl flex-1 flex flex-col justify-between">
                  <div>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-[#1A539B]/30">
                      <div className="flex items-center gap-3.5">
                        <div className="w-12 h-12 rounded-2xl bg-[#1A539B] border border-sky-300/40 flex items-center justify-center text-white shadow-lg shadow-[#1A539B]/40">
                          <Utensils className="w-6 h-6" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-base sm:text-lg font-bold text-white">
                              Alimentador Automático
                            </h3>
                            <span className="text-[11px] font-mono-code px-2 py-0.5 rounded-md bg-[#06101E] text-sky-300 border border-[#1A539B]/50">
                              Servo GPIO 14
                            </span>
                          </div>
                          <p className="text-xs text-sky-200/70">
                            Dispenser rotativo controlado pelo ESP32 • Sincronizado com Supabase
                          </p>
                        </div>
                      </div>

                      {/* Seletor de Porção + Botão Alimentar Agora */}
                      <div className="flex items-center gap-2.5">
                        <select
                          value={selectedPortion}
                          onChange={(e) => setSelectedPortion(e.target.value)}
                          className="bg-[#06101E] border border-[#1A539B]/60 text-xs text-sky-100 rounded-xl px-3 py-2.5 focus:outline-none focus:border-sky-400"
                        >
                          <option value="Leve (3g)">Porção Leve (3g)</option>
                          <option value="Padrão (5g)">Porção Padrão (5g)</option>
                          <option value="Generosa (8g)">Porção Generosa (8g)</option>
                        </select>

                        <button
                          onClick={handleFeedNow}
                          disabled={isFeeding || !espOnline}
                          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-xs sm:text-sm transition-all shadow-lg ${
                            isFeeding
                              ? 'bg-amber-400 text-slate-950 animate-pulse'
                              : !espOnline
                              ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                              : 'bg-gradient-to-r from-[#1A539B] to-sky-500 hover:from-[#2162B5] hover:to-sky-400 text-white border border-white/20'
                          }`}
                        >
                          <Utensils className={`w-4 h-4 ${isFeeding ? 'animate-bounce' : ''}`} />
                          <span>{isFeeding ? 'Dispensando Ração...' : 'Alimentar Agora'}</span>
                        </button>
                      </div>
                    </div>

                    {/* Lista de Horários Programados */}
                    <div className="mt-5">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-sky-200/80 flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-sky-400" />
                          Horários Programados ({schedules.filter((s) => s.enabled).length} ativos)
                        </h4>
                        <span className="text-[11px] text-sky-300/70">Salvos na tabela `feed_schedules`</span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                        {schedules.map((item) => (
                          <div
                            key={item.id}
                            className={`rounded-2xl p-3.5 border transition-all flex items-center justify-between ${
                              item.enabled
                                ? 'bg-[#06101E]/85 border-[#1A539B]/60 text-white'
                                : 'bg-[#06101E]/40 border-white/5 text-slate-500'
                            }`}
                          >
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-lg font-bold font-mono-code tracking-tight">
                                  {item.time}
                                </span>
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#1A539B]/40 text-sky-200 border border-sky-300/20">
                                  {item.label}
                                </span>
                              </div>
                              <span className="text-[11px] text-sky-200/70 block mt-0.5">
                                {item.portion}
                              </span>
                            </div>

                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => handleToggleSchedule(item.id)}
                                title={item.enabled ? 'Desativar horário' : 'Ativar horário'}
                                className={`w-9 h-5 rounded-full transition-colors p-0.5 ${
                                  item.enabled ? 'bg-emerald-500' : 'bg-slate-700'
                                }`}
                              >
                                <div
                                  className={`w-4 h-4 rounded-full bg-white transition-transform ${
                                    item.enabled ? 'translate-x-4' : 'translate-x-0'
                                  }`}
                                />
                              </button>
                              <button
                                onClick={() => handleDeleteSchedule(item.id)}
                                title="Remover horário"
                                className="p-1.5 text-slate-400 hover:text-rose-400 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Formulário rápido para adicionar novo agendamento */}
                  <form
                    onSubmit={handleAddSchedule}
                    className="bg-[#06101E]/80 border border-[#1A539B]/40 rounded-2xl p-3 flex flex-wrap sm:flex-nowrap items-center gap-2.5"
                  >
                    <span className="text-xs font-medium text-sky-200 pl-1 shrink-0">
                      Novo horário:
                    </span>
                    <input
                      type="time"
                      value={newScheduleTime}
                      onChange={(e) => setNewScheduleTime(e.target.value)}
                      className="bg-[#0B1D35] border border-[#1A539B]/60 rounded-xl px-3 py-1.5 text-xs font-mono-code text-white focus:outline-none focus:border-sky-400"
                    />
                    <select
                      value={newSchedulePortion}
                      onChange={(e) => setNewSchedulePortion(e.target.value)}
                      className="bg-[#0B1D35] border border-[#1A539B]/60 rounded-xl px-3 py-1.5 text-xs text-sky-100 focus:outline-none focus:border-sky-400 flex-1"
                    >
                      <option value="Leve (3g)">Leve (3g)</option>
                      <option value="Padrão (5g)">Padrão (5g)</option>
                      <option value="Generosa (8g)">Generosa (8g)</option>
                    </select>
                    <button
                      type="submit"
                      className="bg-[#1A539B] hover:bg-[#2364B8] text-white text-xs font-semibold px-3.5 py-2 rounded-xl flex items-center gap-1.5 border border-sky-300/25 transition-all shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Agendar</span>
                    </button>
                  </form>
                </div>
              </div>
            </div>

            {/* SEÇÃO INFERIOR DO DASHBOARD: GRÁFICO DE VARIAÇÃO + LOGS EM TEMPO REAL */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Gráfico de Variação do Nível da Água (7 colunas) */}
              <div className="lg:col-span-7 bg-[#0B1D35]/90 backdrop-blur-xl rounded-3xl border border-[#1A539B]/50 p-6 shadow-xl">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-sky-400" />
                      Curva de Nível da Água (Últimas 24h)
                    </h3>
                    <p className="text-xs text-sky-200/70">
                      Histórico de leituras do sensor ultrassônico armazenadas no Supabase
                    </p>
                  </div>
                  <span className="text-xs font-mono-code text-sky-300 bg-[#06101E] px-3 py-1 rounded-lg border border-[#1A539B]/40">
                    Taxa de evaporação: ~1.2% / dia
                  </span>
                </div>

                {/* Gráfico de Barras / Linha Estilizado */}
                <div className="h-48 flex items-end justify-between gap-3 pt-6 px-2 border-b border-[#1A539B]/40">
                  {waterHistory.map((point, idx) => {
                    const isLast = idx === waterHistory.length - 1;
                    return (
                      <div key={idx} className="flex-1 flex flex-col items-center gap-2 group">
                        <span className="text-[11px] font-mono-code text-sky-200 opacity-85 group-hover:opacity-100 group-hover:text-white transition">
                          {point.level}%
                        </span>
                        <div className="w-full max-w-[44px] h-32 bg-[#06101E] rounded-t-xl p-1 flex items-end border border-[#1A539B]/30">
                          <div
                            style={{ height: `${point.level}%` }}
                            className={`w-full rounded-t-lg transition-all duration-500 ${
                              isLast
                                ? 'bg-gradient-to-t from-[#1A539B] to-sky-400 shadow-lg shadow-sky-400/30'
                                : 'bg-gradient-to-t from-[#12396B] to-[#1A539B] group-hover:to-sky-400/80'
                            }`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between px-2 pt-2.5 text-[11px] font-mono-code text-sky-200/70">
                  {waterHistory.map((point, idx) => (
                    <div key={idx} className="flex-1 text-center">
                      <div>{point.time}</div>
                      <div className="text-[10px] text-sky-400/70">{point.distance}cm</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Registro de Eventos Recentes (5 colunas) */}
              <div className="lg:col-span-5 bg-[#0B1D35]/90 backdrop-blur-xl rounded-3xl border border-[#1A539B]/50 p-6 shadow-xl flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-base font-bold text-white flex items-center gap-2">
                        <Activity className="w-4 h-4 text-sky-400" />
                        Eventos Recentes (Supabase)
                      </h3>
                      <p className="text-xs text-sky-200/70">
                        Telemetria e acionamentos registrados
                      </p>
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
                        <div
                          className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                            log.type === 'feeder'
                              ? 'bg-amber-500/15 text-amber-300 border border-amber-400/30'
                              : log.type === 'pump'
                              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-400/30'
                              : 'bg-sky-500/15 text-sky-300 border border-sky-400/30'
                          }`}
                        >
                          {log.type === 'feeder' && <Utensils className="w-4 h-4" />}
                          {log.type === 'pump' && <Wind className="w-4 h-4" />}
                          {log.type === 'sensor' && <Waves className="w-4 h-4" />}
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
            ABA: SIMULADOR INTERATIVO DO .APK ANDROID NO NAVEGADOR
           =================================================================== */}
        {activeTab === 'apk-preview' && (
          <MobileApkSimulator
            waterLevelPct={waterLevelPct}
            setWaterLevelPct={setWaterLevelPct}
            ultrasonicDistanceCm={ultrasonicDistanceCm}
            pumpActive={pumpActive}
            onTogglePump={() => handleTogglePump(true)}
            pumpMode={pumpMode}
            setPumpMode={setPumpMode}
            isFeeding={isFeeding}
            onFeedNow={() => handleFeedNow(true)}
            schedules={schedules}
            onToggleSchedule={handleToggleSchedule}
            onDeleteSchedule={handleDeleteSchedule}
            onAddSchedule={(e) => handleAddSchedule(e)}
            logs={logs}
            espOnline={espOnline}
            setEspOnline={setEspOnline}
          />
        )}

        {/* ===================================================================
            ABA 2: HISTÓRICO & LOGS COMPLETOS DO SUPABASE
           =================================================================== */}
        {activeTab === 'history' && (
          <div className="bg-[#0B1D35]/90 backdrop-blur-xl rounded-3xl border border-[#1A539B]/50 p-6 sm:p-8 shadow-xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#1A539B]/40 pb-5">
              <div>
                <h3 className="text-xl font-bold text-white flex items-center gap-2.5">
                  <Database className="w-5 h-5 text-sky-400" />
                  Registros de Telemetria & Acionamentos (Supabase)
                </h3>
                <p className="text-xs sm:text-sm text-sky-200/70 mt-1">
                  Histórico de eventos enviados pelo ESP32 e comandos disparados pela interface web na Vercel.
                </p>
              </div>
              <button
                onClick={() =>
                  addLog(
                    'sensor',
                    `Leitura manual solicitada: ${waterLevelPct}% (${ultrasonicDistanceCm} cm do sensor)`,
                    'Sincronização Manual'
                  )
                }
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#1A539B] hover:bg-[#2364B8] text-xs font-semibold text-white border border-sky-300/30 transition"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Forçar Leitura Agora
              </button>
            </div>

            <div className="space-y-3">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="bg-[#06101E]/85 border border-[#1A539B]/40 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-sky-400/50 transition"
                >
                  <div className="flex items-center gap-3.5">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                        log.type === 'feeder'
                          ? 'bg-amber-500/15 text-amber-300 border border-amber-400/30'
                          : log.type === 'pump'
                          ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-400/30'
                          : 'bg-sky-500/15 text-sky-300 border border-sky-400/30'
                      }`}
                    >
                      {log.type === 'feeder' && <Utensils className="w-5 h-5" />}
                      {log.type === 'pump' && <Wind className="w-5 h-5" />}
                      {log.type === 'sensor' && <Waves className="w-5 h-5" />}
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
            ABA 3: TOPOLOGIA DE HARDWARE (ESP32 + PINAGEM + SUPABASE SCHEMA)
           =================================================================== */}
        {activeTab === 'hardware' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Mapa de Pinagem sugerido para o ESP32 */}
            <div className="bg-[#0B1D35]/90 backdrop-blur-xl rounded-3xl border border-[#1A539B]/50 p-6 sm:p-8 shadow-xl space-y-5">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-[#1A539B] border border-sky-300/30 flex items-center justify-center text-white">
                  <Cpu className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Pinagem do ESP32 (Hardware Netuno)</h3>
                  <p className="text-xs text-sky-200/70">Referência rápida dos periféricos conectados ao microcontrolador</p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="bg-[#06101E]/85 border border-[#1A539B]/40 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-bold text-sky-300">1. Sensor Ultrassônico (HC-SR04)</span>
                    <span className="text-xs font-mono-code bg-[#1A539B]/50 px-2.5 py-0.5 rounded text-white">GPIO 5 (TRIG) / GPIO 18 (ECHO)</span>
                  </div>
                  <p className="text-xs text-sky-200/70">
                    Instalado na tampa superior do aquário apontando para a lâmina d'água. Calcula a distância em centímetros e converte para percentual do volume.
                  </p>
                </div>

                <div className="bg-[#06101E]/85 border border-[#1A539B]/40 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-bold text-emerald-300">2. Módulo Relé (Bomba de Oxigênio)</span>
                    <span className="text-xs font-mono-code bg-[#1A539B]/50 px-2.5 py-0.5 rounded text-white">GPIO 26 (IN) • 5V VCC</span>
                  </div>
                  <p className="text-xs text-sky-200/70">
                    Controla a tomada da bomba submersa/compressor de ar. Possui desligamento automático caso o nível da água baixe para nível crítico.
                  </p>
                </div>

                <div className="bg-[#06101E]/85 border border-[#1A539B]/40 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-bold text-amber-300">3. Alimentador Automático (Servo SG90/MG996R)</span>
                    <span className="text-xs font-mono-code bg-[#1A539B]/50 px-2.5 py-0.5 rounded text-white">GPIO 14 (PWM)</span>
                  </div>
                  <p className="text-xs text-sky-200/70">
                    Gira o compartimento dosador conforme o tempo de abertura (Leve 3g, Padrão 5g ou Generosa 8g).
                  </p>
                </div>
              </div>
            </div>

            {/* Estrutura pronta para o Supabase + Offline + Bluetooth APK */}
            <div className="bg-[#0B1D35]/90 backdrop-blur-xl rounded-3xl border border-[#1A539B]/50 p-6 sm:p-8 shadow-xl space-y-5">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-[#1A539B] border border-sky-300/30 flex items-center justify-center text-white">
                  <Database className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Arquitetura Híbrida (Wi-Fi + Offline + BLE APK)</h3>
                  <p className="text-xs text-sky-200/70">Fluxo integrado entre ESP32, Supabase, Vercel e App Android (.APK)</p>
                </div>
              </div>

              <div className="bg-[#06101E] border border-[#1A539B]/50 rounded-2xl p-4 font-mono-code text-xs text-sky-200 space-y-2 overflow-x-auto">
                <div className="text-sky-400 font-semibold">// 1. Estado em tempo real (Supabase Realtime)</div>
                <div>TABLE <span className="text-white font-bold">aquarium_status</span> (</div>
                <div className="pl-4">id INT, water_level_pct INT, distance_cm FLOAT,</div>
                <div className="pl-4">pump_relay_on BOOLEAN, pump_mode TEXT,</div>
                <div className="pl-4">feed_now_command BOOLEAN, esp_last_seen TIMESTAMPTZ</div>
                <div>);</div>
                <div className="pt-2 text-sky-400 font-semibold">// 2. Agendamentos e Histórico (Online + Fila LittleFS)</div>
                <div>TABLE <span className="text-white font-bold">feed_schedules</span> (id, time, portion, enabled);</div>
                <div>TABLE <span className="text-white font-bold">telemetry_logs</span> (id, event_type, message, source, recorded_at);</div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="bg-[#06101E]/85 border border-[#1A539B]/40 rounded-2xl p-3.5">
                  <div className="flex items-center gap-2 font-bold text-sky-300 mb-1">
                    <Smartphone className="w-4 h-4" />
                    <span>Buffer Offline (LittleFS)</span>
                  </div>
                  <p className="text-sky-200/75 leading-relaxed">
                    Se o Wi-Fi cair, o ESP32 grava as leituras na memória Flash interna e reenvia em lote ao Supabase quando a conexão retorna.
                  </p>
                </div>

                <div className="bg-[#06101E]/85 border border-[#1A539B]/40 rounded-2xl p-3.5">
                  <div className="flex items-center gap-2 font-bold text-sky-300 mb-1">
                    <Bluetooth className="w-4 h-4" />
                    <span>App Android (.APK BLE)</span>
                  </div>
                  <p className="text-sky-200/75 leading-relaxed">
                    Sem Wi-Fi, o .APK chaveia para Bluetooth Low Energy, controla o aquário direto no ESP32 e resgata a fila offline.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* RODAPÉ */}
      <footer className="border-t border-[#1A539B]/30 bg-[#06101E]/90 py-5 px-4 sm:px-6 lg:px-8 mt-8">
        <div className="max-w-7xl mx-auto flex items-center justify-center gap-2.5 text-xs text-sky-200/60">
          <img src="/logo-netuno.jpg" alt="Netuno" className="w-6 h-6 rounded-md object-cover border border-white/20" />
          <span className="font-serif font-bold tracking-widest text-white">NETUNO</span>
        </div>
      </footer>
    </div>
  );
}

