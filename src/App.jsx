import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Waves,
  Thermometer,
  Monitor,
  Activity,
  AlertTriangle,
  RefreshCw,
  TrendingUp,
  ChevronRight,
  ChevronLeft,
  Gauge,
  Wind,
  Utensils,
  Settings,
  CheckCircle2,
  Sliders,
  Plus,
  Trash2,
  Power,
  RotateCcw,
  Save,
  Sparkles,
  Droplets,
  Clock,
  Wifi,
  Lock,
  Eye,
  EyeOff,
  Radio,
  ArrowLeft,
  User,
  LogOut,
  ShieldCheck,
  Snowflake
} from 'lucide-react';
import { supabase, isSupabaseConfigured } from './lib/supabase';

const SNOWFLAKES = [
  { left: '4%', size: 12, duration: '11s', delay: '0s', drift: '18px' },
  { left: '11%', size: 9, duration: '14s', delay: '2.2s', drift: '-14px' },
  { left: '19%', size: 14, duration: '10s', delay: '4.1s', drift: '22px' },
  { left: '27%', size: 10, duration: '13s', delay: '1.3s', drift: '-18px' },
  { left: '35%', size: 13, duration: '9.5s', delay: '3.5s', drift: '16px' },
  { left: '44%', size: 9, duration: '12.5s', delay: '0.7s', drift: '-20px' },
  { left: '53%', size: 15, duration: '10.8s', delay: '5.2s', drift: '20px' },
  { left: '61%', size: 10, duration: '13.5s', delay: '2.8s', drift: '-15px' },
  { left: '70%', size: 13, duration: '11.4s', delay: '0.4s', drift: '24px' },
  { left: '78%', size: 9, duration: '14.5s', delay: '4.8s', drift: '-18px' },
  { left: '86%', size: 14, duration: '10.2s', delay: '1.9s', drift: '15px' },
  { left: '94%', size: 11, duration: '12.2s', delay: '3.1s', drift: '-22px' },
];

const CHRISTMAS_LIGHTS = [
  '#EF4444',
  '#10B981',
  '#FBBF24',
  '#38BDF8',
  '#EF4444',
  '#10B981',
  '#FBBF24',
  '#EF4444',
  '#10B981',
  '#FBBF24',
  '#38BDF8',
  '#EF4444',
  '#10B981',
  '#FBBF24',
];

const DEFAULT_CONFIG = {
  deviceUsername: '',
  devicePassword: '',
  wifiSsid: 'Iphone de JL',
  wifiPassword: '',
  wifiSecurity: 'WPA2-PSK',
  wifiApName: 'NETUNO-SETUP',
  wifiPortalIp: '10.0.0.1',
  autoPortalOnFirstBoot: true,
  savedWifiNetworks: [
    { id: 1, ssid: 'Iphone de JL', password: '', priority: 'Principal (1ª opção)' },
    { id: 2, ssid: 'Casa_Fibra_2.4G', password: '', priority: 'Reserva Automática (2ª opção)' },
  ],
  aquariumName: 'Aquário Principal',
  lengthCm: 25,
  widthCm: 13,
  heightCm: 18,
  sensorOffsetCm: 2,
  criticalLevelPct: 35,
  warningLevelPct: 65,
  maxAlertLevelPct: 95,
  tempMinC: 22,
  tempMaxC: 29,
  lcdLine1Mode: 'water_pct', // 'water_pct' | 'volume_liters' | 'custom_title'
  lcdLine2Mode: 'temp_c', // 'temp_c' | 'pump_status' | 'next_feed'
  lcdCarousel: false,
  lcdCustomText: 'NETUNO AQUARIO',
  pumpMode: 'auto', // 'auto' | 'manual'
  pumpCycleOnMin: 45,
  pumpCycleOffMin: 15,
  pumpSafetyCutoffPct: 30,
  portionLightMs: 400,
  portionStandardMs: 700,
  portionGenerousMs: 1100,
  defaultPortion: 'Padrão (5g)',
  setupCompleted: true,
};

export default function App() {
  // Carrega configurações salvas localmente (ou usa padrão)
  const [config, setConfig] = useState(() => {
    try {
      const saved = localStorage.getItem('netuno_router_config');
      if (saved) return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
    } catch (e) {
      // ignore
    }
    return DEFAULT_CONFIG;
  });

  // Rascunho para o Assistente de Configuração (estilo Roteador)
  const [draftConfig, setDraftConfig] = useState(config);
  const [wizardStep, setWizardStep] = useState(1); // 1 a 6
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [exclusiveSetupMode, setExclusiveSetupMode] = useState(() => !config.setupCompleted);
  const [showWifiPassword, setShowWifiPassword] = useState(false);
  const [scanningWifi, setScanningWifi] = useState(false);
  const [wifiTestStatus, setWifiTestStatus] = useState(null);
  const [availableNetworks, setAvailableNetworks] = useState([
    { ssid: 'Iphone de JL', rssi: -46, security: 'WPA2-PSK' },
    { ssid: 'Casa_Fibra_2.4G', rssi: -58, security: 'WPA2-PSK' },
    { ssid: 'Netuno_Guest', rssi: -71, security: 'WPA2-PSK' },
  ]);

  // Estados de leitura e operação
  const [loading, setLoading] = useState(true);
  const [espOnline, setEspOnline] = useState(false);
  const [lastSeenIso, setLastSeenIso] = useState(null);

  const [waterLevelPct, setWaterLevelPct] = useState(null);
  const [distanceCm, setDistanceCm] = useState(null);
  const [temperatureC, setTemperatureC] = useState(null);
  const [rtcTimestamp, setRtcTimestamp] = useState(() => new Date().toISOString());
  const [pumpRelayOn, setPumpRelayOn] = useState(true);
  const [pumpMode, setPumpMode] = useState(config.pumpMode || 'auto');
  const [feedNowCommand, setFeedNowCommand] = useState(false);
  const [feedNowPortion, setFeedNowPortion] = useState(config.defaultPortion || 'Padrão (5g)');
  const [schedules, setSchedules] = useState([
    { id: 1, time: '08:00', portion: 'Padrão (5g)', label: 'Manhã', enabled: true },
    { id: 2, time: '14:00', portion: 'Leve (3g)', label: 'Tarde', enabled: true },
    { id: 3, time: '20:00', portion: 'Padrão (5g)', label: 'Noite', enabled: true },
  ]);
  const [newScheduleTime, setNewScheduleTime] = useState('18:00');
  const [newSchedulePortion, setNewSchedulePortion] = useState('Padrão (5g)');
  const formatLocalDateInput = (dateObj) => {
    const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const [rtcEditDate, setRtcEditDate] = useState(() => formatLocalDateInput(new Date()));
  const [rtcEditTime, setRtcEditTime] = useState(() =>
    new Date().toTimeString().slice(0, 8)
  );
  const [rtcSaveNotice, setRtcSaveNotice] = useState(false);
  const [wifiPortalCommandSent, setWifiPortalCommandSent] = useState(false);
  const [lastAutoFedMinuteKey, setLastAutoFedMinuteKey] = useState('');
  const lastDbRtcRef = useRef(null);
  const rtcLockUntilRef = useRef(0);

  const [logs, setLogs] = useState([]);
  const [history, setHistory] = useState([]);
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard' | 'setup' | 'history'
  const [carouselTick, setCarouselTick] = useState(0);
  const [christmasMode, setChristmasMode] = useState(() => {
    try {
      return localStorage.getItem('netuno_christmas_mode') === 'true';
    } catch (e) {
      return false;
    }
  });

  useEffect(() => {
    document.body.classList.toggle('christmas-theme', christmasMode);
    try {
      localStorage.setItem('netuno_christmas_mode', String(christmasMode));
    } catch (e) {
      // ignore
    }
  }, [christmasMode]);

  // Autenticação do ESP32 específico (usuário e senha cadastrados no portal 192.168.4.1 do ESP32)
  const [authDevice, setAuthDevice] = useState(() => {
    try {
      const saved = localStorage.getItem('netuno_esp_auth');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      // ignore
    }
    return null;
  });
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const activeDeviceUsername = authDevice?.username || '';

  // Avança o relógio do RTC a cada 1 segundo (e sincroniza sempre que o banco envia atualização)
  useEffect(() => {
    const timer = setInterval(() => {
      setRtcTimestamp((prev) => {
        const base = prev ? new Date(prev).getTime() : Date.now();
        return new Date(base + 1000).toISOString();
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const rtcDateObj = rtcTimestamp ? new Date(rtcTimestamp) : new Date();
  const rtcTimeFormatted = rtcDateObj.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const rtcDateFormatted = rtcDateObj.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  // Alternância do carrossel do LCD quando ativado
  useEffect(() => {
    const activeCfg = activeTab === 'setup' ? draftConfig : config;
    if (!activeCfg.lcdCarousel) {
      setCarouselTick(0);
      return;
    }
    const timer = setInterval(() => {
      setCarouselTick((prev) => (prev + 1) % 2);
    }, 4000);
    return () => clearInterval(timer);
  }, [activeTab, config.lcdCarousel, draftConfig.lcdCarousel]);

  // Dimensões dinâmicas a partir da configuração ativa
  const activeCfg = activeTab === 'setup' ? draftConfig : config;
  const TANK_LENGTH_CM = Math.max(5, Number(activeCfg.lengthCm) || 25);
  const TANK_WIDTH_CM = Math.max(5, Number(activeCfg.widthCm) || 13);
  const TANK_HEIGHT_CM = Math.max(8, Number(activeCfg.heightCm) || 18);
  const SENSOR_OFFSET_CM = Math.max(2, Math.min(10, Number(activeCfg.sensorOffsetCm) || 2));
  const MAX_COLUMN_CM = Math.max(1, TANK_HEIGHT_CM - SENSOR_OFFSET_CM);

  const hasSensorData = waterLevelPct !== null;

  const waterColumnCm =
    distanceCm !== null
      ? Math.max(0, Math.min(MAX_COLUMN_CM, TANK_HEIGHT_CM - Number(distanceCm))).toFixed(1)
      : waterLevelPct !== null
      ? ((Number(waterLevelPct) / 100) * MAX_COLUMN_CM).toFixed(1)
      : null;

  const waterVolumeLiters =
    waterColumnCm !== null
      ? ((TANK_LENGTH_CM * TANK_WIDTH_CM * Number(waterColumnCm)) / 1000).toFixed(2)
      : null;
  const maxVolumeLiters = ((TANK_LENGTH_CM * TANK_WIDTH_CM * MAX_COLUMN_CM) / 1000).toFixed(2);

  // Status do Nível da Água usando os limites configurados
  const getWaterStatus = (pct, cfg = config) => {
    if (pct === null) {
      return {
        label: 'Sem leitura',
        color: 'text-slate-300',
        bg: 'bg-slate-500/15 border-slate-400/30',
      };
    }
    if (pct < Number(cfg.criticalLevelPct))
      return {
        label: 'CRÍTICO — Repor Água',
        color: 'text-rose-400',
        bg: 'bg-rose-500/15 border-rose-500/40',
      };
    if (pct < Number(cfg.warningLevelPct))
      return {
        label: 'ATENÇÃO — Nível Baixo',
        color: 'text-amber-300',
        bg: 'bg-amber-500/15 border-amber-500/40',
      };
    if (pct > Number(cfg.maxAlertLevelPct))
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

  // Status da Temperatura usando os limites configurados
  const getTempStatus = (temp, cfg = config) => {
    if (temp === null) {
      return {
        label: 'Sem leitura',
        color: 'text-slate-300',
        bg: 'bg-slate-500/15 border-slate-400/30',
      };
    }
    if (temp < Number(cfg.tempMinC))
      return {
        label: 'BAIXA — Água Fria',
        color: 'text-sky-300',
        bg: 'bg-sky-500/15 border-sky-400/40',
      };
    if (temp > Number(cfg.tempMaxC))
      return {
        label: 'ALTA — Água Quente',
        color: 'text-rose-400',
        bg: 'bg-rose-500/15 border-rose-500/40',
      };
    return {
      label: `IDEAL (${cfg.tempMinC}°C – ${cfg.tempMaxC}°C)`,
      color: 'text-emerald-300',
      bg: 'bg-emerald-500/15 border-emerald-400/30',
    };
  };

  const waterStatus = getWaterStatus(waterLevelPct, activeCfg);
  const tempStatus = getTempStatus(temperatureC, activeCfg);

  const activeSchedules = schedules
    .filter((s) => s.enabled)
    .sort((a, b) => a.time.localeCompare(b.time));

  // Calcula o próximo horário de alimentação baseado exclusivamente no horário atual do módulo RTC
  const rtcCurrentHHMM = `${String(rtcDateObj.getHours()).padStart(2, '0')}:${String(
    rtcDateObj.getMinutes()
  ).padStart(2, '0')}`;
  const rtcCurrentSeconds = rtcDateObj.getSeconds();

  const nextSchedule =
    activeSchedules.find((s) => s.time > rtcCurrentHHMM) ||
    (activeSchedules.length > 0 ? activeSchedules[0] : null);

  // Finaliza o ciclo breve de alimentação (volta os peixes ao nado normal e limpa o status)
  const finishFeedingCycle = useCallback(() => {
    setFeedNowCommand(false);
    if (isSupabaseConfigured && supabase && activeDeviceUsername) {
      supabase
        .from('aquarium_status')
        .update({ feed_now_command: false })
        .ilike('device_username', activeDeviceUsername)
        .then(() => {}, () => {});
    }
  }, [activeDeviceUsername]);

  // Garante que o status "Alimentando..." e a animação de comer dos peixes durem apenas o ciclo breve (2.2s)
  useEffect(() => {
    if (!feedNowCommand) return;
    const timer = setTimeout(() => {
      finishFeedingCycle();
    }, 2200);
    return () => clearTimeout(timer);
  }, [feedNowCommand, finishFeedingCycle]);

  // Acionamento automático do alimentador quando o horário do módulo RTC atinge exatamente um horário programado
  useEffect(() => {
    if (!activeDeviceUsername) return;
    if (rtcCurrentSeconds > 2) return; // Verifica nos primeiros segundos do minuto do RTC
    const match = activeSchedules.find((s) => s.time === rtcCurrentHHMM);
    if (!match) return;

    const minuteKey = `${rtcDateFormatted}_${rtcCurrentHHMM}`;
    if (lastAutoFedMinuteKey === minuteKey) return;

    setLastAutoFedMinuteKey(minuteKey);
    setFeedNowCommand(true);
    setFeedNowPortion(match.portion);
    if (isSupabaseConfigured && supabase) {
      supabase
        .from('aquarium_status')
        .update({ feed_now_command: true, feed_now_portion: match.portion })
        .ilike('device_username', activeDeviceUsername)
        .then(() => {}, () => {});
    }
  }, [
    activeDeviceUsername,
    rtcCurrentHHMM,
    rtcCurrentSeconds,
    rtcDateFormatted,
    activeSchedules,
    lastAutoFedMinuteKey,
  ]);

  // Formata linha de 16 caracteres para o Display LCD
  const formatLcdLine = (mode, cfg) => {
    const previewPct = waterLevelPct !== null ? waterLevelPct : 85;
    const previewTemp = temperatureC !== null ? Number(temperatureC).toFixed(1) : '26.0';
    const previewVol =
      waterVolumeLiters !== null
        ? waterVolumeLiters
        : ((TANK_LENGTH_CM * TANK_WIDTH_CM * (MAX_COLUMN_CM * 0.85)) / 1000).toFixed(1);

    switch (mode) {
      case 'water_pct':
        return hasSensorData || activeTab === 'setup'
          ? `Nivel Agua: ${String(previewPct).padStart(3, ' ')}%`.slice(0, 16).padEnd(16, ' ')
          : 'Display LCD     ';
      case 'volume_liters':
        return hasSensorData || activeTab === 'setup'
          ? `Volume: ${String(previewVol).padStart(5, ' ')} L`.slice(0, 16).padEnd(16, ' ')
          : 'Display LCD     ';
      case 'custom_title':
        return String(cfg.lcdCustomText || 'NETUNO AQUARIO')
          .toUpperCase()
          .slice(0, 16)
          .padEnd(16, ' ');
      case 'temp_c':
        return temperatureC !== null || activeTab === 'setup'
          ? `Temp: ${String(previewTemp).padStart(5, ' ')} C`.slice(0, 16).padEnd(16, ' ')
          : 'Sem leituras    ';
      case 'pump_status':
        return `Bomba: ${pumpRelayOn ? 'Ligada  ' : 'Deslig. '}`.slice(0, 16).padEnd(16, ' ');
      case 'next_feed':
        return nextSchedule
          ? `Comida: ${nextSchedule.time}`.slice(0, 16).padEnd(16, ' ')
          : 'Comida: --:--   ';
      case 'rtc_time':
        return `Hora: ${rtcTimeFormatted}`.slice(0, 16).padEnd(16, ' ');
      default:
        return 'Display LCD     ';
    }
  };

  const lcdLine0 =
    activeCfg.lcdCarousel && carouselTick === 1
      ? formatLcdLine('volume_liters', activeCfg)
      : formatLcdLine(activeCfg.lcdLine1Mode, activeCfg);

  const lcdLine1 =
    activeCfg.lcdCarousel && carouselTick === 1
      ? formatLcdLine('rtc_time', activeCfg)
      : formatLcdLine(activeCfg.lcdLine2Mode, activeCfg);

  const formatLogTime = (isoStr) => {
    if (!isoStr) return '--:--';
    const d = new Date(isoStr);
    return d.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatShortTime = (isoStr) => {
    if (!isoStr) return '--:--';
    const d = new Date(isoStr);
    return d.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Busca dados do banco filtrando pelo usuário do ESP32 autenticado
  const fetchSupabaseData = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase || !activeDeviceUsername) {
      setLoading(false);
      return;
    }

    setLoading(true);

    const { data: statusData, error: statusError } = await supabase
      .from('aquarium_status')
      .select('*')
      .ilike('device_username', activeDeviceUsername)
      .maybeSingle();

    if (!statusData) {
      // Dispositivo não existe no banco de dados (sessão inválida antiga salva no localStorage)
      setAuthDevice(null);
      try {
        localStorage.removeItem('netuno_esp_auth');
      } catch (e) {
        // ignore
      }
      setLoginError(`O dispositivo "${activeDeviceUsername}" não foi encontrado no banco de dados. Faça login com um dispositivo cadastrado.`);
      setLoading(false);
      return;
    }

    if (statusData) {
      if (statusData.pump_relay_on !== undefined && statusData.pump_relay_on !== null) {
        setPumpRelayOn(Boolean(statusData.pump_relay_on));
      }
      if (statusData.pump_mode) {
        setPumpMode(statusData.pump_mode);
      }
      if (statusData.feed_now_command) {
        // Limpa eventual flag residual no banco para não travar a tela em "Alimentando..." ao abrir o site
        setFeedNowCommand(false);
        supabase
          .from('aquarium_status')
          .update({ feed_now_command: false })
          .ilike('device_username', activeDeviceUsername)
          .then(() => {}, () => {});
      } else {
        setFeedNowCommand(false);
      }
      if (statusData.feed_now_portion) {
        setFeedNowPortion(statusData.feed_now_portion);
      }

      const espEverSent =
        Number(statusData.distance_cm) > 0 ||
        Number(statusData.water_level_pct) > 0 ||
        Boolean(statusData.esp_last_seen) ||
        Boolean(statusData.rtc_datetime);

      if (espEverSent) {
        if (statusData.water_level_pct !== undefined && statusData.water_level_pct !== null) {
          setWaterLevelPct(Number(statusData.water_level_pct));
        }
        if (statusData.distance_cm !== undefined && statusData.distance_cm !== null) {
          setDistanceCm(Number(statusData.distance_cm));
        }
        if (statusData.temperature_c !== undefined && statusData.temperature_c !== null) {
          setTemperatureC(Number(statusData.temperature_c));
        }
        lastDbRtcRef.current = statusData.rtc_datetime || null;
        const seenAt = statusData.rtc_datetime || statusData.esp_last_seen || statusData.updated_at;
        if (seenAt) {
          setLastSeenIso(seenAt);
          const diffSec = Math.max(
            0,
            Math.floor((Date.now() - new Date(seenAt).getTime()) / 1000)
          );
          const isOnline = diffSec < 30;
          setEspOnline(isOnline);

          // Só aplica rtc_datetime do banco se o ESP32 estiver online (ou comando pendente) e não houver trava recente do usuário
          if (
            Date.now() > rtcLockUntilRef.current &&
            (isOnline || statusData.rtc_set_command) &&
            statusData.rtc_datetime
          ) {
            setRtcTimestamp(statusData.rtc_datetime);
          }
        }
      } else {
        setWaterLevelPct(null);
        setDistanceCm(null);
        setTemperatureC(null);
        setEspOnline(false);
      }
    }

    const { data: scheduleData } = await supabase
      .from('feed_schedules')
      .select('*')
      .ilike('device_username', activeDeviceUsername)
      .order('time', { ascending: true });

    if (scheduleData && scheduleData.length > 0) {
      setSchedules(scheduleData);
    }

    const { data: logData } = await supabase
      .from('telemetry_logs')
      .select('*')
      .ilike('device_username', activeDeviceUsername)
      .order('recorded_at', { ascending: false })
      .limit(20);

    if (logData) {
      setLogs(
        logData.map((l) => ({
          id: l.id,
          time: formatLogTime(l.recorded_at),
          type: l.event_type,
          message: l.message,
          source: l.source,
        }))
      );

      const recentPoints = logData
        .filter((l) => l.water_level_pct !== null && l.water_level_pct !== undefined)
        .slice(0, 7)
        .reverse()
        .map((l) => ({
          time: formatShortTime(l.recorded_at),
          level: Number(l.water_level_pct),
          temp: l.temperature_c !== null && l.temperature_c !== undefined ? Number(l.temperature_c) : null,
        }));

      setHistory(recentPoints);
    }

    setLoading(false);
  }, [activeDeviceUsername]);

  useEffect(() => {
    if (!lastSeenIso) return;
    const interval = setInterval(() => {
      const diffSec = Math.max(
        0,
        Math.floor((Date.now() - new Date(lastSeenIso).getTime()) / 1000)
      );
      setEspOnline(diffSec < 30);
    }, 1000);
    return () => clearInterval(interval);
  }, [lastSeenIso]);

  useEffect(() => {
    fetchSupabaseData();

    if (!isSupabaseConfigured || !supabase || !activeDeviceUsername) return;

    const channel = supabase
      .channel(`netuno-web-realtime-${activeDeviceUsername}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'aquarium_status' },
        (payload) => {
          const s = payload.new;
          if (!s) return;
          if (s.device_username && s.device_username !== activeDeviceUsername) return;
          if (s.water_level_pct !== undefined && s.water_level_pct !== null) {
            setWaterLevelPct(Number(s.water_level_pct));
          }
          if (s.distance_cm !== undefined && s.distance_cm !== null) {
            setDistanceCm(Number(s.distance_cm));
          }
          if (s.temperature_c !== undefined && s.temperature_c !== null) {
            setTemperatureC(Number(s.temperature_c));
          }
          if (s.pump_relay_on !== undefined && s.pump_relay_on !== null) {
            setPumpRelayOn(Boolean(s.pump_relay_on));
          }
          if (s.pump_mode) {
            setPumpMode(s.pump_mode);
          }
          if (s.feed_now_command === false) {
            setFeedNowCommand(false);
          }
          if (s.feed_now_portion) {
            setFeedNowPortion(s.feed_now_portion);
          }
          const rtcChanged = Boolean(
            s.rtc_datetime && s.rtc_datetime !== lastDbRtcRef.current
          );
          if (rtcChanged) {
            lastDbRtcRef.current = s.rtc_datetime;
            const nowIso = s.rtc_datetime;
            setLastSeenIso(nowIso);
            const diffSec = Math.max(
              0,
              Math.floor((Date.now() - new Date(nowIso).getTime()) / 1000)
            );
            const isRecentClock = diffSec < 120;
            if (isRecentClock) {
              setEspOnline(true);
            }
            if (
              Date.now() > rtcLockUntilRef.current &&
              (isRecentClock || s.rtc_set_command)
            ) {
              setRtcTimestamp(nowIso);
            }
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'feed_schedules' },
        () => {
          supabase
            .from('feed_schedules')
            .select('*')
            .eq('device_username', activeDeviceUsername)
            .order('time', { ascending: true })
            .then(({ data }) => {
              if (data) setSchedules(data);
            });
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'telemetry_logs' },
        (payload) => {
          const l = payload.new;
          if (!l) return;
          if (l.device_username && l.device_username !== activeDeviceUsername) return;
          setLogs((prev) => [
            {
              id: l.id,
              time: formatLogTime(l.recorded_at),
              type: l.event_type,
              message: l.message,
              source: l.source,
            },
            ...prev.slice(0, 19),
          ]);

          if (l.water_level_pct !== null && l.water_level_pct !== undefined) {
            setHistory((prev) => [
              ...prev.slice(-6),
              {
                time: formatShortTime(l.recorded_at),
                level: Number(l.water_level_pct),
                temp:
                  l.temperature_c !== null && l.temperature_c !== undefined
                    ? Number(l.temperature_c)
                    : null,
              },
            ]);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchSupabaseData, activeDeviceUsername]);

  // Autenticação por usuário e senha daquele ESP32 específico
  const handleDeviceLogin = async (e) => {
    e.preventDefault();
    const cleanUser = loginUsername.trim();
    const cleanPass = loginPassword.trim();
    if (!cleanUser || !cleanPass) {
      setLoginError('Informe o Usuário e a Senha configurados no seu ESP32.');
      return;
    }

    setLoginLoading(true);
    setLoginError('');

    try {
      if (isSupabaseConfigured && supabase) {
        const { data: existingDevice, error: fetchError } = await supabase
          .from('aquarium_status')
          .select('*')
          .ilike('device_username', cleanUser)
          .maybeSingle();

        if (fetchError) {
          setLoginError('Erro ao consultar o banco no Supabase. Tente novamente em instantes.');
          setLoginLoading(false);
          return;
        }

        if (!existingDevice) {
          setLoginError(
            `Nenhum ESP32 encontrado com o usuário "${cleanUser}". Verifique se digitou o nome de usuário correto ou configure o ESP32 primeiro na rede Wi-Fi NETUNO-SETUP (10.0.0.1).`
          );
          setLoginLoading(false);
          return;
        }

        if (
          existingDevice.device_password &&
          existingDevice.device_password !== cleanPass
        ) {
          setLoginError('Senha incorreta para este ESP32. Verifique a senha cadastrada no dispositivo.');
          setLoginLoading(false);
          return;
        }

        // Caso o ESP32 antigo estivesse sem senha gravada, atualiza com a senha digitada
        if (!existingDevice.device_password) {
          await supabase
            .from('aquarium_status')
            .update({ device_password: cleanPass })
            .eq('id', existingDevice.id);
        }

        const canonicalUsername = existingDevice.device_username || cleanUser;
        const sessionData = {
          username: canonicalUsername,
          password: cleanPass,
          deviceId: existingDevice.device_id || 'ESP32',
        };
        setAuthDevice(sessionData);
        localStorage.setItem('netuno_esp_auth', JSON.stringify(sessionData));
        setConfig((prev) => ({
          ...prev,
          deviceUsername: canonicalUsername,
          devicePassword: cleanPass,
        }));
        setDraftConfig((prev) => ({
          ...prev,
          deviceUsername: canonicalUsername,
          devicePassword: cleanPass,
        }));
      } else {
        setLoginError('Serviço Supabase não está configurado.');
      }
    } catch (err) {
      setLoginError('Falha ao conectar com o servidor: ' + (err.message || 'Erro de conexão'));
    }

    setLoginLoading(false);
  };

  const handleDeviceLogout = () => {
    setAuthDevice(null);
    setLoginPassword('');
    setLoginError('');
    setWaterLevelPct(null);
    setDistanceCm(null);
    setTemperatureC(null);
    setLogs([]);
    setHistory([]);
    try {
      localStorage.removeItem('netuno_esp_auth');
    } catch (e) {
      // ignore
    }
  };

  // Funções de controle e salvamento do assistente
  const handleTogglePump = async () => {
    const next = !pumpRelayOn;
    setPumpRelayOn(next);
    setFeedNowCommand(false); // Garante que a alimentação não seja acionada ao alternar a bomba
    if (isSupabaseConfigured && supabase && activeDeviceUsername) {
      await supabase
        .from('aquarium_status')
        .update({ pump_relay_on: next, feed_now_command: false })
        .eq('device_username', activeDeviceUsername);
    }
  };

  const handleTriggerFeedNow = (portion = draftConfig.defaultPortion) => {
    setFeedNowCommand(true);
    setFeedNowPortion(portion);
    if (isSupabaseConfigured && supabase && activeDeviceUsername) {
      supabase
        .from('aquarium_status')
        .update({ feed_now_command: true, feed_now_portion: portion })
        .ilike('device_username', activeDeviceUsername)
        .then(() => {}, () => {});
    }
  };

  const handleAddSchedule = async (e) => {
    e.preventDefault();
    if (!newScheduleTime) return;
    const newItem = {
      id: Date.now(),
      device_username: activeDeviceUsername || 'admin',
      time: newScheduleTime,
      portion: newSchedulePortion,
      label: 'Programado',
      enabled: true,
    };
    setSchedules((prev) => [...prev, newItem].sort((a, b) => a.time.localeCompare(b.time)));
    if (isSupabaseConfigured && supabase && activeDeviceUsername) {
      await supabase.from('feed_schedules').insert([
        {
          device_username: activeDeviceUsername,
          time: newScheduleTime,
          portion: newSchedulePortion,
          label: 'Programado',
          enabled: true,
        },
      ]);
    }
  };

  const handleToggleSchedule = async (id) => {
    const target = schedules.find((s) => s.id === id);
    if (!target) return;
    const nextEnabled = !target.enabled;
    setSchedules((prev) =>
      prev.map((s) => (s.id === id ? { ...s, enabled: nextEnabled } : s))
    );
    if (isSupabaseConfigured && supabase) {
      await supabase.from('feed_schedules').update({ enabled: nextEnabled }).eq('id', id);
    }
  };

  const handleDeleteSchedule = async (id) => {
    setSchedules((prev) => prev.filter((s) => s.id !== id));
    if (isSupabaseConfigured && supabase) {
      await supabase.from('feed_schedules').delete().eq('id', id);
    }
  };

  // Ajusta manualmente ou sincroniza o horário que ficará gravado no módulo RTC do ESP32
  const handleApplyRtcDateTime = async (customIso = null) => {
    let targetIso = customIso;
    if (!targetIso) {
      const safeTime =
        rtcEditTime && rtcEditTime.length === 5 ? `${rtcEditTime}:00` : rtcEditTime || '12:00:00';
      const parsed = new Date(`${rtcEditDate}T${safeTime}`);
      targetIso = !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
    } else {
      const d = new Date(targetIso);
      setRtcEditDate(formatLocalDateInput(d));
      setRtcEditTime(d.toTimeString().slice(0, 8));
    }

    rtcLockUntilRef.current = Date.now() + 15000;
    lastDbRtcRef.current = targetIso;
    setRtcTimestamp(targetIso);
    setRtcSaveNotice(true);
    setTimeout(() => setRtcSaveNotice(false), 2500);

    if (isSupabaseConfigured && supabase && activeDeviceUsername) {
      supabase
        .from('aquarium_status')
        .update({
          rtc_datetime: targetIso,
          rtc_set_command: true,
        })
        .ilike('device_username', activeDeviceUsername)
        .then(() => {}, () => {});
    }
  };

  const handleSaveWizardConfig = async () => {
    const cleanNewUser = (draftConfig.deviceUsername || activeDeviceUsername || '').trim();
    const cleanNewPass = (draftConfig.devicePassword || authDevice?.password || '').trim();

    const finalConfig = {
      ...draftConfig,
      deviceUsername: cleanNewUser,
      devicePassword: cleanNewPass,
      setupCompleted: true,
    };
    setConfig(finalConfig);
    setPumpMode(finalConfig.pumpMode);
    setFeedNowPortion(finalConfig.defaultPortion);
    try {
      localStorage.setItem('netuno_router_config', JSON.stringify(finalConfig));
    } catch (e) {
      // ignore
    }
    if (isSupabaseConfigured && supabase && activeDeviceUsername) {
      const updatePayload = {
        pump_mode: finalConfig.pumpMode,
        pump_cycle_minutes: Number(finalConfig.pumpCycleOnMin) || 45,
        feed_now_portion: finalConfig.defaultPortion,
      };
      if (cleanNewPass) {
        updatePayload.device_password = cleanNewPass;
      }
      await supabase
        .from('aquarium_status')
        .update(updatePayload)
        .eq('device_username', activeDeviceUsername);
    }
    setSaveSuccess(true);
    setTimeout(() => {
      setSaveSuccess(false);
      setExclusiveSetupMode(false);
      setActiveTab('dashboard');
    }, 1200);
  };

  // Envia apenas o sinal para o ESP32 abrir o painel de configuração inicial (NETUNO-SETUP 10.0.0.1) sem mudar de aba
  const handleSendEspPortalCommand = () => {
    setWifiPortalCommandSent(true);

    if (isSupabaseConfigured && supabase && activeDeviceUsername) {
      supabase
        .from('aquarium_status')
        .update({ wifi_setup_command: true })
        .ilike('device_username', activeDeviceUsername)
        .then(() => {}, () => {});
    }

    setTimeout(() => setWifiPortalCommandSent(false), 5000);
  };

  const handleScanWifiNetworks = () => {
    setScanningWifi(true);
    setTimeout(() => {
      setAvailableNetworks([
        { ssid: 'Iphone de JL', rssi: -44, security: 'WPA2-PSK' },
        { ssid: 'Casa_Fibra_2.4G', rssi: -55, security: 'WPA2-PSK' },
        { ssid: 'Vivo-Fibra-2G', rssi: -67, security: 'WPA2-PSK' },
        { ssid: 'Netuno_Guest', rssi: -74, security: 'WPA2-PSK' },
      ]);
      setScanningWifi(false);
    }, 900);
  };

  const handleTestWifiConnection = () => {
    if (!draftConfig.wifiSsid) return;
    setWifiTestStatus('connecting');
    setTimeout(() => {
      setWifiTestStatus('connected');
    }, 1000);
  };

  const handleResetFactoryDefaults = () => {
    const firstBootConfig = { ...DEFAULT_CONFIG, setupCompleted: false };
    setDraftConfig(firstBootConfig);
    setConfig(firstBootConfig);
    setWizardStep(1);
    setExclusiveSetupMode(true);
    setActiveTab('setup');
    try {
      localStorage.setItem('netuno_router_config', JSON.stringify(firstBootConfig));
    } catch (e) {
      // ignore
    }
  };

  const wizardSteps = [
    {
      step: 1,
      title: 'Acesso & Aquário',
      icon: Droplets,
    },
    {
      step: 2,
      title: 'Nível & Temperatura',
      icon: Waves,
    },
    {
      step: 3,
      title: 'Display LCD',
      icon: Monitor,
    },
    {
      step: 4,
      title: 'RTC, Bomba & Ração',
      icon: Clock,
    },
  ];

  // TELA DE LOGIN CLEAN COM ANIMAÇÃO SUAVE PARA ACESSAR O ESP32 ESPECÍFICO
  if (!authDevice) {
    return (
      <div
        className={`min-h-screen flex flex-col justify-between text-slate-100 relative overflow-hidden transition-colors duration-500 ${
          christmasMode
            ? 'bg-[#05110d] selection:bg-rose-600 selection:text-white'
            : 'bg-[#040B16] selection:bg-[#1A539B] selection:text-white'
        }`}
      >
        {/* Flocos de neve quando o Modo Natalino estiver ativo */}
        {christmasMode && (
          <div className="pointer-events-none fixed inset-0 z-30 overflow-hidden">
            {SNOWFLAKES.map((flake, i) => (
              <span
                key={i}
                style={{
                  left: flake.left,
                  '--snow-duration': flake.duration,
                  '--snow-delay': flake.delay,
                  '--snow-drift': flake.drift,
                }}
                className="snowflake-particle absolute -top-6 text-white/75 select-none drop-shadow-[0_0_6px_rgba(255,255,255,0.6)]"
              >
                <Snowflake style={{ width: flake.size, height: flake.size }} />
              </span>
            ))}
          </div>
        )}

        {/* Botãozinho no topo para alternar Modo Natalino */}
        <div className="absolute top-4 right-4 z-20">
          <button
            type="button"
            onClick={() => setChristmasMode((prev) => !prev)}
            className={`inline-flex items-center justify-center p-2 rounded-xl border transition-all duration-200 active:scale-95 ${
              christmasMode
                ? 'bg-gradient-to-r from-rose-600/80 to-emerald-600/80 border-amber-300/60 text-amber-100 shadow-md shadow-rose-500/25'
                : 'bg-white/[0.05] hover:bg-rose-500/20 border-white/10 hover:border-rose-400/40 text-sky-200 hover:text-white'
            }`}
            title={christmasMode ? 'Desativar Modo Natalino' : 'Ativar Modo Natalino'}
            aria-label="Alternar Modo Natalino"
          >
            <Snowflake className={`w-4 h-4 ${christmasMode ? 'text-amber-200' : 'text-sky-300'}`} />
          </button>
        </div>

        {/* Luzes de fundo sutis e animadas */}
        <div
          className={`pointer-events-none absolute -top-28 -left-28 w-96 h-96 rounded-full blur-3xl animate-pulse ${
            christmasMode ? 'bg-rose-600/20' : 'bg-[#1A539B]/20'
          }`}
        />
        <div
          className={`pointer-events-none absolute -bottom-28 -right-28 w-96 h-96 rounded-full blur-3xl animate-pulse ${
            christmasMode ? 'bg-emerald-500/20' : 'bg-sky-500/15'
          }`}
        />

        <div className="flex-1 flex items-center justify-center p-4 sm:p-6 relative z-10">
          <div className="w-full max-w-md clean-card rounded-3xl overflow-hidden animate-scale-in">
            <div
              className={`border-b border-white/[0.08] p-7 text-center ${
                christmasMode
                  ? 'bg-gradient-to-b from-rose-950/60 via-emerald-950/30 to-transparent'
                  : 'bg-gradient-to-b from-[#0C213E]/80 to-transparent'
              }`}
            >
              <div className="relative mx-auto w-16 h-16 mb-3.5 animate-float">
                {christmasMode && (
                  <svg
                    viewBox="0 0 36 28"
                    className="absolute -top-3.5 -right-2.5 w-8 h-7 z-20 rotate-[18deg] drop-shadow-md pointer-events-none"
                  >
                    <path d="M5 20C9 7 20 2 29 9C24 14 23 18 24 21Z" fill="#DC2626" />
                    <rect x="3" y="18.5" width="22" height="5" rx="2.5" fill="#F8FAFC" />
                    <circle cx="30" cy="10" r="3" fill="#F8FAFC" />
                  </svg>
                )}
                <div
                  className={`w-16 h-16 rounded-2xl overflow-hidden border shadow-xl flex items-center justify-center ${
                    christmasMode ? 'border-amber-300/60 bg-rose-700' : 'border-sky-300/40 bg-[#1A539B]'
                  }`}
                >
                  <img
                    src="/logo-netuno.jpg"
                    alt="Logo Netuno"
                    className="w-full h-full object-cover scale-105"
                  />
                </div>
              </div>
              <h1 className="font-serif text-2xl font-bold tracking-[0.2em] text-white">
                NETUNO
              </h1>
              <p className="text-xs text-sky-200/70 mt-1">
                Monitoramento Inteligente do Aquário
              </p>
            </div>

            <form onSubmit={handleDeviceLogin} className="p-6 sm:p-7 space-y-4">
              <div className="bg-[#06101E]/70 border border-sky-400/20 rounded-2xl p-3.5 text-xs text-sky-200/80 space-y-1">
                <div className="font-semibold text-sky-300 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-300 shrink-0" />
                  <span>Vínculo com seu ESP32</span>
                </div>
                <p className="leading-relaxed text-[11px] text-sky-200/65">
                  No primeiro uso, conecte-se ao Wi-Fi{' '}
                  <strong className="text-white font-mono-code">NETUNO-SETUP</strong> (<strong className="text-emerald-300 font-mono-code">10.0.0.1</strong>) para criar seu usuário e senha.
                </p>
              </div>

              {loginError && (
                <div className="bg-rose-500/15 border border-rose-400/35 rounded-xl p-3 text-xs text-rose-200 flex items-center gap-2 animate-scale-in">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{loginError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-sky-200/90 mb-1.5">
                  Usuário do ESP32
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-sky-400/80 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    maxLength={32}
                    value={loginUsername}
                    onChange={(e) => setLoginUsername(e.target.value)}
                    placeholder="Ex: aquario_joao"
                    className="w-full bg-[#06101E]/90 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-400/70 transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-sky-200/90 mb-1.5">
                  Senha do ESP32
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-sky-400/80 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type={showLoginPassword ? 'text' : 'password'}
                    required
                    maxLength={32}
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="Digite sua senha"
                    className="w-full bg-[#06101E]/90 border border-white/10 rounded-xl pl-10 pr-10 py-3 text-sm font-mono-code text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-400/70 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLoginPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-sky-300/60 hover:text-white transition-colors"
                  >
                    {showLoginPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loginLoading}
                className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-[#1A539B] to-sky-500 hover:from-[#2161B2] hover:to-sky-400 active:scale-[0.99] text-white text-sm font-bold border border-sky-300/30 shadow-lg shadow-[#1A539B]/35 transition-all duration-200 flex items-center justify-center gap-2"
              >
                <ShieldCheck className="w-4 h-4" />
                {loginLoading ? 'Conectando...' : 'Entrar no Painel'}
              </button>
            </form>
          </div>
        </div>

        <footer className="border-t border-white/[0.06] bg-[#040B16]/80 py-4 px-4 text-center text-xs text-sky-200/50">
          NETUNO • Monitoramento Inteligente
        </footer>
      </div>
    );
  }

  return (
    <div
      className={`min-h-screen flex flex-col text-slate-100 transition-colors duration-500 ${
        christmasMode ? 'selection:bg-rose-600 selection:text-white' : 'selection:bg-[#1A539B] selection:text-white'
      }`}
    >
      {/* Flocos de neve sutis no Modo Natalino */}
      {christmasMode && (
        <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
          {SNOWFLAKES.map((flake, i) => (
            <span
              key={i}
              style={{
                left: flake.left,
                '--snow-duration': flake.duration,
                '--snow-delay': flake.delay,
                '--snow-drift': flake.drift,
              }}
              className="snowflake-particle absolute -top-6 text-white/70 select-none drop-shadow-[0_0_6px_rgba(255,255,255,0.55)]"
            >
              <Snowflake style={{ width: flake.size, height: flake.size }} />
            </span>
          ))}
        </div>
      )}

      {/* ALERTA DE NÍVEL CRÍTICO */}
      {waterLevelPct !== null && waterLevelPct < Number(config.criticalLevelPct) && (
        <div className="bg-rose-600/90 backdrop-blur-md border-b border-rose-400/40 px-4 py-2 text-center text-xs sm:text-sm font-medium text-white flex items-center justify-center gap-2 animate-pulse">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            <strong>Alerta de Nível:</strong> O nível da água está crítico ({waterLevelPct}%).
          </span>
        </div>
      )}

      {/* HEADER PRINCIPAL CLEAN & GLASSMORPHIC */}
      <header
        className={`sticky top-0 z-30 border-b backdrop-blur-2xl transition-all relative ${
          christmasMode
            ? 'border-amber-400/25 bg-[#061510]/90'
            : 'border-white/[0.08] bg-[#040B16]/85'
        }`}
      >
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-16 sm:h-20 flex items-center justify-between gap-2 sm:gap-4">
          {/* Identidade Visual */}
          <div className="flex items-center gap-2.5 sm:gap-3.5 min-w-0">
            <div className="relative group cursor-pointer shrink-0" onClick={() => setActiveTab('dashboard')}>
              <div
                className={`absolute -inset-1 rounded-2xl blur transition duration-300 ${
                  christmasMode
                    ? 'bg-gradient-to-tr from-rose-600 via-amber-400 to-emerald-500 opacity-65 group-hover:opacity-90'
                    : 'bg-gradient-to-tr from-[#1A539B] to-sky-400 opacity-50 group-hover:opacity-80'
                }`}
              ></div>
              {christmasMode && (
                <svg
                  viewBox="0 0 36 28"
                  className="absolute -top-3 -right-2 w-6 h-5 sm:w-7 sm:h-6 z-20 rotate-[18deg] drop-shadow-md pointer-events-none"
                >
                  <path d="M5 20C9 7 20 2 29 9C24 14 23 18 24 21Z" fill="#DC2626" />
                  <rect x="3" y="18.5" width="22" height="5" rx="2.5" fill="#F8FAFC" />
                  <circle cx="30" cy="10" r="3" fill="#F8FAFC" />
                </svg>
              )}
              <div
                className={`relative w-10 h-10 sm:w-13 sm:h-13 rounded-xl sm:rounded-2xl overflow-hidden border shadow-lg flex items-center justify-center transition-transform duration-300 group-hover:scale-105 ${
                  christmasMode ? 'border-amber-300/60 bg-rose-700' : 'border-white/25 bg-[#1A539B]'
                }`}
              >
                <img
                  src="/logo-netuno.jpg"
                  alt="Logo Netuno"
                  className="w-full h-full object-cover scale-105"
                />
              </div>
            </div>
            <div className="min-w-0">
              <h1 className="font-serif text-lg sm:text-2xl font-bold tracking-[0.14em] sm:tracking-[0.18em] text-white truncate">
                NETUNO
              </h1>
              <p className={`text-[11px] hidden sm:block truncate ${christmasMode ? 'text-amber-200/80' : 'text-sky-300/70'}`}>
                {christmasMode ? `${config.aquariumName} • Boas Festas 🎄` : `${config.aquariumName} • ${maxVolumeLiters} L`}
              </p>
              <p className="text-[10px] text-emerald-300/80 sm:hidden font-mono-code truncate flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                {activeDeviceUsername}
              </p>
            </div>
          </div>

          {/* Navegação Central Minimalista */}
          <nav
            className={`hidden md:flex items-center p-1 rounded-2xl border shadow-inner ${
              christmasMode
                ? 'bg-[#091E16]/85 border-amber-400/20'
                : 'bg-[#09172B]/80 border-white/[0.08]'
            }`}
          >
            {[
              { id: 'dashboard', label: 'Painel', icon: Gauge },
              { id: 'history', label: 'Histórico', icon: TrendingUp },
              { id: 'setup', label: 'Configurações', icon: Settings },
            ].map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    if (tab.id === 'setup') setDraftConfig(config);
                    setActiveTab(tab.id);
                  }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-200 ${
                    active
                      ? christmasMode
                        ? 'bg-gradient-to-r from-rose-600 to-emerald-600 text-white shadow-md shadow-rose-500/30 border border-amber-300/40 scale-[1.02]'
                        : 'bg-gradient-to-r from-[#1A539B] to-[#2364B8] text-white shadow-md shadow-[#1A539B]/40 border border-sky-300/25 scale-[1.02]'
                      : 'text-sky-200/65 hover:text-white hover:bg-white/[0.04]'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 transition-transform duration-300 ${active ? 'scale-110' : ''}`} />
                  {tab.label}
                </button>
              );
            })}
          </nav>

          {/* Ações + Relógio RTC no Canto Superior Direito */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            <div className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-xs">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-mono-code font-medium text-sky-100">{activeDeviceUsername}</span>
            </div>

            {/* Botãozinho de Modo Natalino no topo */}
            <button
              type="button"
              onClick={() => setChristmasMode((prev) => !prev)}
              className={`inline-flex items-center justify-center p-1.5 sm:p-2 rounded-xl border transition-all duration-200 active:scale-95 ${
                christmasMode
                  ? 'bg-gradient-to-r from-rose-600/85 to-emerald-600/85 border-amber-300/60 text-amber-100 shadow-md shadow-rose-500/25'
                  : 'bg-white/[0.04] hover:bg-rose-500/20 border-white/[0.09] hover:border-rose-400/40 text-sky-200 hover:text-white'
              }`}
              title={christmasMode ? 'Desativar Modo Natalino' : 'Ativar Modo Natalino'}
              aria-label="Alternar Modo Natalino"
            >
              <Snowflake className={`w-3.5 h-3.5 shrink-0 ${christmasMode ? 'text-amber-200' : 'text-sky-300'}`} />
            </button>

            <button
              onClick={handleSendEspPortalCommand}
              className={`inline-flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl border text-[11px] font-semibold transition-all duration-200 active:scale-95 whitespace-nowrap ${
                wifiPortalCommandSent
                  ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300 shadow-md shadow-emerald-500/20'
                  : 'bg-white/[0.04] hover:bg-[#1A539B]/50 border-white/[0.09] hover:border-sky-400/40 text-sky-200 hover:text-white'
              }`}
              title="Envia sinal para o ESP32 abrir a rede NETUNO-SETUP (10.0.0.1)"
            >
              <Wifi className={`w-3.5 h-3.5 shrink-0 ${wifiPortalCommandSent ? 'text-emerald-300 animate-pulse' : 'text-sky-400'}`} />
              <span className="hidden sm:inline">
                {wifiPortalCommandSent ? 'Sinal Enviado ao ESP32!' : 'Abrir Painel no ESP32'}
              </span>
              <span className="sm:hidden">
                {wifiPortalCommandSent ? 'Enviado!' : 'ESP32'}
              </span>
            </button>

            <button
              onClick={handleDeviceLogout}
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl bg-white/[0.04] hover:bg-rose-500/20 border border-white/[0.09] hover:border-rose-400/40 text-[11px] font-semibold text-sky-200/85 hover:text-rose-200 transition-all duration-200 active:scale-95"
              title="Logout"
              aria-label="Sair"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Logout</span>
            </button>

            <div className="hidden sm:block h-6 w-px bg-white/10 mx-1" />

            {/* Relógio RTC posicionado no canto extremo direito */}
            <div className="flex items-center gap-1.5 sm:gap-2 text-right pl-0.5">
              <Clock className={`w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 animate-pulse ${christmasMode ? 'text-amber-300' : 'text-sky-400'}`} />
              <div>
                <div className="font-mono-code text-xs sm:text-lg font-extrabold text-white tracking-wider leading-none">
                  {rtcTimeFormatted}
                </div>
                <div className="text-[10px] text-sky-300/70 hidden sm:block mt-0.5 font-mono-code">
                  {rtcDateFormatted}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Cordão de luzinhas de Natal na borda do cabeçalho */}
        {christmasMode && (
          <div className="pointer-events-none flex items-center justify-around px-2 py-0.5 border-t border-white/[0.05] bg-[#040E0B]/80">
            {CHRISTMAS_LIGHTS.map((color, idx) => (
              <span
                key={idx}
                style={{
                  backgroundColor: color,
                  boxShadow: `0 0 8px ${color}`,
                  '--twinkle-duration': `${1.4 + (idx % 4) * 0.35}s`,
                  '--twinkle-delay': `${(idx % 5) * 0.25}s`,
                }}
                className="christmas-bulb w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full"
              />
            ))}
          </div>
        )}

        {/* Navegação Mobile Clean */}
        <div
          className={`grid grid-cols-3 gap-1.5 md:hidden border-t px-3 py-2 ${
            christmasMode
              ? 'border-amber-400/15 bg-[#05120D]/95'
              : 'border-white/[0.06] bg-[#06101E]/95'
          }`}
        >
          {[
            { id: 'dashboard', label: 'Painel', icon: Gauge },
            { id: 'history', label: 'Histórico', icon: TrendingUp },
            { id: 'setup', label: 'Configurações', icon: Settings },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  if (tab.id === 'setup') setDraftConfig(config);
                  setActiveTab(tab.id);
                }}
                className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
                  active
                    ? christmasMode
                      ? 'bg-gradient-to-r from-rose-600 to-emerald-600 text-white shadow-md shadow-rose-500/25 border border-amber-300/35'
                      : 'bg-gradient-to-r from-[#1A539B] to-[#2364B8] text-white shadow-md shadow-[#1A539B]/30 border border-sky-300/20'
                    : 'text-sky-200/70 hover:text-white bg-white/[0.02]'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </header>

      {/* Notificação flutuante de sinal enviado para o ESP32 */}
      {wifiPortalCommandSent && (
        <div className="fixed top-28 sm:top-20 left-3 right-3 sm:left-auto sm:right-8 z-50 sm:max-w-md bg-[#071324]/95 border border-emerald-400/40 rounded-2xl p-3.5 sm:p-4 shadow-2xl backdrop-blur-md text-xs text-emerald-200 flex items-start gap-3 animate-fade-up">
          <Radio className="w-5 h-5 text-emerald-300 shrink-0 mt-0.5 animate-pulse" />
          <div className="space-y-1">
            <div className="font-bold text-white flex items-center gap-2 flex-wrap">
              <span>Sinal Enviado ao ESP32!</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-400/20 text-emerald-300 font-mono-code font-bold">10.0.0.1</span>
            </div>
            <p className="text-sky-200/80 leading-relaxed text-[11px]">
              O comando foi registrado no Supabase. O ESP32 abrirá o ponto de acesso Wi-Fi <strong className="text-white font-mono-code">NETUNO-SETUP</strong> para configuração inicial pelo IP <strong className="text-emerald-300 font-mono-code">10.0.0.1</strong>.
            </p>
          </div>
        </div>
      )}

      {/* CONTEÚDO PRINCIPAL */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8 space-y-4 sm:space-y-6">
        {/* RESUMO RÁPIDO DOS 4 INDICADORES COM MICRO-INTERAÇÕES E ANIMAÇÃO */}
        {activeTab === 'dashboard' && (
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 animate-fade-up">
            {/* Card 1: Nível da Água */}
            <div className="clean-kpi rounded-2xl p-3.5 sm:p-5 flex flex-col justify-between gap-2.5 sm:gap-3 group">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-[10px] sm:text-[11px] font-medium uppercase tracking-wider text-sky-200/65 block">
                    Nível d'Água
                  </span>
                  <span className="text-2xl sm:text-3xl font-extrabold text-white mt-1 block tracking-tight">
                    {waterLevelPct !== null ? `${waterLevelPct}%` : '--'}
                  </span>
                  <span className={`text-[10px] sm:text-[11px] font-medium mt-0.5 block truncate ${waterStatus.color}`}>
                    {waterStatus.label}
                  </span>
                </div>
                <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl sm:rounded-2xl bg-sky-500/15 border border-sky-400/25 flex items-center justify-center text-sky-300 shrink-0 transition-transform duration-300 group-hover:scale-110">
                  <Waves className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
              </div>

              <div className="pt-2 flex items-center justify-between text-[10px] sm:text-[11px] text-sky-200/60 border-t border-white/[0.04]">
                <span>Volume Útil:</span>
                <span className="font-mono-code font-bold text-sky-200">
                  {waterVolumeLiters !== null ? `${waterVolumeLiters} L` : '--'}
                </span>
              </div>
            </div>

            {/* Card 2: Temperatura */}
            <div className="clean-kpi rounded-2xl p-3.5 sm:p-5 flex flex-col justify-between gap-2.5 sm:gap-3 group">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-[10px] sm:text-[11px] font-medium uppercase tracking-wider text-sky-200/65 block">
                    Temperatura
                  </span>
                  <span className="text-2xl sm:text-3xl font-extrabold text-emerald-300 mt-1 block tracking-tight">
                    {temperatureC !== null ? `${Number(temperatureC).toFixed(1)} °C` : '--'}
                  </span>
                  <span className="text-[10px] sm:text-[11px] text-sky-200/75 mt-0.5 block truncate">
                    {tempStatus.label}
                  </span>
                </div>
                <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl sm:rounded-2xl bg-emerald-500/15 border border-emerald-400/25 flex items-center justify-center text-emerald-300 shrink-0 transition-transform duration-300 group-hover:scale-110">
                  <Thermometer className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
              </div>

              <div className="pt-2 flex items-center justify-between text-[10px] sm:text-[11px] text-sky-200/60 border-t border-white/[0.04]">
                <span>Faixa Ideal:</span>
                <span className="font-mono-code font-bold text-emerald-300">
                  {config.tempMinC}°C–{config.tempMaxC}°C
                </span>
              </div>
            </div>

            {/* Card 3: Bomba de Oxigênio */}
            <div className="col-span-2 sm:col-span-1 clean-kpi rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-3 group">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-[11px] font-medium uppercase tracking-wider text-sky-200/65 block">
                    Bomba de Oxigênio
                  </span>
                  <span
                    className={`text-2xl sm:text-3xl font-extrabold mt-1 block tracking-tight transition-colors ${
                      pumpRelayOn ? 'text-emerald-300' : 'text-amber-300'
                    }`}
                  >
                    {pumpRelayOn ? 'Ligada' : 'Desligada'}
                  </span>
                  <span className="text-[11px] text-sky-200/75 mt-0.5 block">
                    Modo {pumpMode === 'auto' ? 'Automático' : 'Manual'}
                  </span>
                </div>
                <div
                  className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl border flex items-center justify-center shrink-0 transition-all duration-300 group-hover:scale-110 ${
                    pumpRelayOn
                      ? 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300'
                      : 'bg-amber-500/15 border-amber-400/30 text-amber-300'
                  }`}
                >
                  <Wind className={`w-5 h-5 ${pumpRelayOn ? 'animate-pulse' : ''}`} />
                </div>
              </div>

              <button
                type="button"
                onClick={handleTogglePump}
                className={`w-full py-2.5 sm:py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.98] ${
                  pumpRelayOn
                    ? 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-400/40 shadow-sm shadow-emerald-500/15'
                    : 'bg-white/[0.06] hover:bg-white/[0.12] text-sky-200 border border-white/10'
                }`}
                title="Ligar ou desligar a bomba de oxigênio"
              >
                <Power className="w-3.5 h-3.5" />
                <span>{pumpRelayOn ? 'Desligar Bomba' : 'Ligar Bomba'}</span>
              </button>
            </div>

            {/* Card 4: Alimentador com Opção de Alimentar Manualmente */}
            <div className="col-span-2 sm:col-span-1 clean-kpi rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-3 group">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-[11px] font-medium uppercase tracking-wider text-sky-200/65 block">
                    Alimentador
                  </span>
                  <span className="text-xl sm:text-2xl font-extrabold text-sky-300 mt-1 block tracking-tight">
                    {feedNowCommand
                      ? 'Alimentando...'
                      : nextSchedule
                      ? `Próx: ${nextSchedule.time}`
                      : 'Programado'}
                  </span>
                  <span className="text-[11px] text-emerald-300/90 mt-0.5 block">
                    Porção: {nextSchedule ? nextSchedule.portion : feedNowPortion}
                  </span>
                </div>
                <div
                  className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl border flex items-center justify-center shrink-0 transition-all duration-300 group-hover:scale-110 ${
                    feedNowCommand
                      ? 'bg-amber-400/20 border-amber-300/50 text-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.35)]'
                      : 'bg-sky-500/15 border-sky-400/25 text-sky-300'
                  }`}
                >
                  <Utensils className={`w-5 h-5 ${feedNowCommand ? 'animate-bounce text-amber-300' : ''}`} />
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleTriggerFeedNow(config.defaultPortion || 'Padrão (5g)')}
                disabled={feedNowCommand}
                className={`w-full py-2.5 sm:py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.98] ${
                  feedNowCommand
                    ? 'bg-amber-400/25 text-amber-200 border border-amber-300/40 cursor-not-allowed animate-pulse'
                    : 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 shadow-md shadow-amber-500/20 hover:shadow-amber-500/35'
                }`}
                title="Acionar alimentação manual imediata dos peixes"
              >
                <Utensils className={`w-3.5 h-3.5 ${feedNowCommand ? 'animate-bounce' : ''}`} />
                <span>{feedNowCommand ? 'Alimentando Peixes...' : 'Alimentar Manualmente'}</span>
              </button>
            </div>
          </section>
        )}

        {/* ===================================================================
            ABA 1: PAINEL PRINCIPAL CLEAN & ANIMADO
           =================================================================== */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 items-stretch">
              {/* COLUNA ESQUERDA (6 cols): NÍVEL DA ÁGUA INTERATIVO */}
              <div className="lg:col-span-6 clean-card rounded-2xl sm:rounded-3xl p-4 sm:p-6 flex flex-col justify-between animate-fade-up">
                <div>
                  <div className="flex flex-wrap items-start justify-between gap-2.5 sm:gap-4 mb-4 sm:mb-5">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-2xl bg-sky-500/15 border border-sky-400/30 flex items-center justify-center text-sky-300 shrink-0">
                        <Waves className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-base font-bold text-white">
                          Nível da Água
                        </h3>
                        <p className="text-[11px] sm:text-xs text-sky-200/65">
                          Capacidade útil: {maxVolumeLiters} L ({TANK_LENGTH_CM} × {TANK_WIDTH_CM} × {TANK_HEIGHT_CM} cm)
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`px-2.5 sm:px-3 py-1 rounded-full text-[11px] sm:text-xs font-semibold border transition-all ${waterStatus.bg} ${waterStatus.color}`}
                      >
                        {waterStatus.label}
                      </span>
                    </div>
                  </div>

                  {/* Visualização Gráfica do Aquário com Ondas, Bolhas de Oxigênio e Ração */}
                  <div className="relative h-56 sm:h-64 rounded-2xl bg-gradient-to-b from-[#040C18] to-[#07162C] border border-sky-400/25 overflow-hidden shadow-inner mb-4 sm:mb-5">
                    {/* Reflexo de vidro sutil */}
                    <div className="pointer-events-none absolute top-0 left-6 w-24 h-full bg-gradient-to-r from-white/[0.03] to-transparent -skew-x-12 z-20" />

                    {/* Régua lateral minimalista */}
                    <div className="absolute right-3.5 inset-y-4 z-20 flex flex-col justify-between text-[10px] font-mono-code text-sky-200/45 pointer-events-none">
                      <span>100%</span>
                      <span>75%</span>
                      <span>50%</span>
                      <span>25%</span>
                      <span>0%</span>
                    </div>

                    {/* Dispenser + Partículas de ração caindo quando alimentando */}
                    {feedNowCommand && (
                      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-36 h-32 z-30 pointer-events-none flex flex-col items-center">
                        {/* Bico liberando ração no topo */}
                        <div className="w-8 h-2 rounded-b-lg bg-amber-400/80 border border-amber-200 shadow-[0_0_12px_rgba(251,191,36,0.8)]" />
                        <div className="relative w-full h-full">
                          <span
                            style={{ '--pellet-duration': '1.2s', '--pellet-delay': '0s', '--drift': '-8px', left: '38%' }}
                            className="food-pellet absolute top-1 w-2.5 h-2.5 rounded-full bg-amber-400 border border-amber-100"
                          />
                          <span
                            style={{ '--pellet-duration': '1.35s', '--pellet-delay': '0.12s', '--drift': '10px', left: '52%' }}
                            className="food-pellet absolute top-1 w-2 h-2 rounded-full bg-orange-400 border border-amber-100"
                          />
                          <span
                            style={{ '--pellet-duration': '1.15s', '--pellet-delay': '0.25s', '--drift': '-4px', left: '46%' }}
                            className="food-pellet absolute top-1 w-2.5 h-2.5 rounded-full bg-amber-300 border border-white"
                          />
                          <span
                            style={{ '--pellet-duration': '1.3s', '--pellet-delay': '0.38s', '--drift': '6px', left: '58%' }}
                            className="food-pellet absolute top-1 w-2 h-2 rounded-full bg-amber-500 border border-amber-100"
                          />
                          <span
                            style={{ '--pellet-duration': '1.25s', '--pellet-delay': '0.5s', '--drift': '-10px', left: '42%' }}
                            className="food-pellet absolute top-1 w-2.5 h-2.5 rounded-full bg-orange-300 border border-white"
                          />
                        </div>
                      </div>
                    )}

                    {/* Mangueirinha de tomada de ar subindo da bombinha até o topo externo do aquário */}
                    <div className="pointer-events-none absolute top-0 bottom-7 left-[26px] z-20 flex flex-col items-center">
                      {/* Ponteira de captação de ar na borda superior do aquário */}
                      <div
                        className={`w-3.5 h-2 rounded-b-md border transition-all duration-300 ${
                          pumpRelayOn
                            ? 'bg-gradient-to-b from-sky-300 to-slate-700 border-white/50 shadow-[0_0_8px_rgba(56,189,248,0.6)]'
                            : 'bg-gradient-to-b from-slate-600 to-slate-800 border-white/20 opacity-75'
                        }`}
                      />
                      {/* Mangueira translúcida (com fluxo animado apenas quando ligada) */}
                      <div
                        className={`w-[4px] flex-1 rounded-full border-x transition-all duration-300 ${
                          pumpRelayOn
                            ? 'border-sky-200/45 air-hose-active shadow-[0_0_8px_rgba(56,189,248,0.35)]'
                            : 'border-sky-200/20 bg-sky-200/10'
                        }`}
                      />
                    </div>

                    {/* Água animada */}
                    <div
                      className="absolute bottom-0 inset-x-0 transition-all duration-1000 ease-out"
                      style={{ height: `${waterLevelPct !== null ? waterLevelPct : 0}%` }}
                    >
                      <div className="absolute -top-3 left-0 w-[200%] h-6 bg-[#1A539B]/80 rounded-[40%] animate-wave-slow"></div>
                      <div className="absolute -top-2 left-0 w-[200%] h-5 bg-sky-400/35 rounded-[45%] animate-wave-fast"></div>
                      <div className="w-full h-full bg-gradient-to-b from-[#1A539B]/80 via-[#133E75]/85 to-[#092244] relative overflow-hidden">
                        {/* Raios de luz subaquáticos sutis */}
                        <div className="pointer-events-none absolute inset-0 z-[2] opacity-40">
                          <div className="absolute -top-4 left-[18%] w-16 h-44 bg-gradient-to-b from-sky-300/20 to-transparent -rotate-12 blur-md" />
                          <div className="absolute -top-4 left-[48%] w-24 h-48 bg-gradient-to-b from-cyan-200/15 to-transparent rotate-6 blur-lg" />
                          <div className="absolute -top-4 right-[20%] w-14 h-40 bg-gradient-to-b from-sky-300/15 to-transparent rotate-12 blur-md" />
                        </div>

                        {/* Decorações do fundo do aquário: areia, pedrinhas, concha, estrela-do-mar, coral e algas */}
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[4]">
                          {/* Algas marinhas à esquerda-centro (longe da bombinha) */}
                          <div className="absolute bottom-2 left-[19%] sm:left-[21%] animate-seaweed opacity-85">
                            <svg width="34" height="66" viewBox="0 0 34 66" fill="none">
                              <path
                                d="M12 65C9 52 16 42 11 28C7 17 13 8 15 2C18 11 14 19 17 29C21 41 14 52 16 65H12Z"
                                fill="url(#seaweedGradLeft1)"
                              />
                              <path
                                d="M21 65C24 54 18 44 23 32C26 24 23 15 25 10C29 18 26 26 27 35C28 45 23 54 25 65H21Z"
                                fill="url(#seaweedGradLeft2)"
                              />
                              <defs>
                                <linearGradient id="seaweedGradLeft1" x1="13" y1="2" x2="13" y2="65" gradientUnits="userSpaceOnUse">
                                  <stop stopColor="#34D399" stopOpacity="0.9" />
                                  <stop offset="1" stopColor="#065F46" stopOpacity="0.95" />
                                </linearGradient>
                                <linearGradient id="seaweedGradLeft2" x1="24" y1="10" x2="24" y2="65" gradientUnits="userSpaceOnUse">
                                  <stop stopColor="#2DD4BF" stopOpacity="0.85" />
                                  <stop offset="1" stopColor="#0F766E" stopOpacity="0.95" />
                                </linearGradient>
                              </defs>
                            </svg>
                          </div>

                          {/* Algas maiores + coral rosado à direita (sem encostar na régua lateral) */}
                          <div className="absolute bottom-2 right-11 sm:right-14 flex items-end gap-1.5 opacity-90">
                            {/* Árvore de Natal subaquática no Modo Natalino */}
                            {christmasMode && (
                              <svg width="36" height="54" viewBox="0 0 36 54" fill="none" className="mr-1 drop-shadow-[0_2px_8px_rgba(251,191,36,0.35)]">
                                <rect x="15.5" y="45" width="5" height="7" rx="1" fill="#78350F" />
                                <path d="M18 10L6 27H30L18 10Z" fill="#059669" />
                                <path d="M18 19L4 36H32L18 19Z" fill="#047857" />
                                <path d="M18 28L2 46H34L18 28Z" fill="#065F46" />
                                {/* Estrela dourada no topo */}
                                <path
                                  d="M18 2L19.6 6.2L24 6.5L20.6 9.3L21.7 13.5L18 11.2L14.3 13.5L15.4 9.3L12 6.5L16.4 6.2Z"
                                  fill="#FBBF24"
                                />
                                {/* Bolinhas coloridas */}
                                <circle cx="14" cy="24" r="1.8" fill="#EF4444" />
                                <circle cx="22" cy="25" r="1.8" fill="#FBBF24" />
                                <circle cx="11" cy="34" r="1.9" fill="#38BDF8" />
                                <circle cx="19" cy="33" r="1.9" fill="#EF4444" />
                                <circle cx="25" cy="35" r="1.8" fill="#FBBF24" />
                                <circle cx="13" cy="43" r="2" fill="#FBBF24" />
                                <circle cx="23" cy="42" r="2" fill="#FB7185" />
                              </svg>
                            )}

                            {/* Coral ramificado */}
                            <svg width="42" height="44" viewBox="0 0 42 44" fill="none" className="drop-shadow-[0_2px_6px_rgba(244,114,182,0.25)]">
                              <path
                                d="M21 42V25M21 25C16 22 12 17 11 10M21 25C25 21 29 17 31 11M16 20C16 15 18 11 17 6M26 19C26 14 24 10 25 5M13 15C9 15 7 13 5 11M29 16C33 15 35 13 37 10"
                                stroke="url(#coralGrad)"
                                strokeWidth="4.2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                              <defs>
                                <linearGradient id="coralGrad" x1="21" y1="5" x2="21" y2="42" gradientUnits="userSpaceOnUse">
                                  <stop stopColor="#FB7185" />
                                  <stop offset="0.6" stopColor="#F43F5E" />
                                  <stop offset="1" stopColor="#9F1239" />
                                </linearGradient>
                              </defs>
                            </svg>

                            {/* Tufo de algas altas à direita */}
                            <div className="animate-seaweed-alt">
                              <svg width="42" height="82" viewBox="0 0 42 82" fill="none">
                                <path
                                  d="M12 81C8 65 17 51 11 35C7 22 14 11 16 2C20 13 14 23 18 36C23 50 14 65 17 81H12Z"
                                  fill="url(#seaweedGradRight1)"
                                />
                                <path
                                  d="M23 81C28 66 19 52 25 36C29 25 23 15 26 7C31 17 28 28 30 39C32 52 25 66 28 81H23Z"
                                  fill="url(#seaweedGradRight2)"
                                />
                                <path
                                  d="M32 81C35 70 31 59 35 48C37 41 35 34 37 29C40 36 37 43 38 51C39 61 34 71 36 81H32Z"
                                  fill="#10B981"
                                  fillOpacity="0.65"
                                />
                                <defs>
                                  <linearGradient id="seaweedGradRight1" x1="14" y1="2" x2="14" y2="81" gradientUnits="userSpaceOnUse">
                                    <stop stopColor="#6EE7B7" stopOpacity="0.9" />
                                    <stop offset="1" stopColor="#047857" stopOpacity="0.95" />
                                  </linearGradient>
                                  <linearGradient id="seaweedGradRight2" x1="27" y1="7" x2="27" y2="81" gradientUnits="userSpaceOnUse">
                                    <stop stopColor="#34D399" stopOpacity="0.85" />
                                    <stop offset="1" stopColor="#065F46" stopOpacity="0.95" />
                                  </linearGradient>
                                </defs>
                              </svg>
                            </div>
                          </div>

                          {/* Pedrinhas lisas, concha e estrela-do-mar no substrato */}
                          <svg
                            viewBox="0 0 600 42"
                            preserveAspectRatio="none"
                            className="w-full h-7 sm:h-8 block"
                          >
                            {/* Leito de areia ondulado no fundo do aquário */}
                            <path
                              d="M0 24C80 15 160 28 250 20C340 12 430 27 520 19C555 16 582 18 600 22V42H0V24Z"
                              fill="url(#sandGrad)"
                            />
                            <path
                              d="M0 30C95 23 190 34 295 27C395 20 490 33 600 26V42H0V30Z"
                              fill="url(#sandGradFront)"
                            />

                            {/* Conjunto de pedrinhas arredondadas à esquerda-centro */}
                            <ellipse cx="122" cy="27" rx="16" ry="7" fill="#334155" />
                            <ellipse cx="122" cy="25.5" rx="13" ry="4.5" fill="#475569" opacity="0.65" />
                            <ellipse cx="142" cy="29" rx="11" ry="5.5" fill="#1E293B" />
                            <ellipse cx="106" cy="30" rx="9" ry="4.5" fill="#475569" />

                            {/* Pedrinha central discreta */}
                            <ellipse cx="305" cy="31" rx="14" ry="5" fill="#1E293B" opacity="0.85" />
                            <ellipse cx="322" cy="33" rx="8" ry="3.5" fill="#334155" opacity="0.85" />

                            {/* Concha com pérola e pedrinhas próximas ao coral à direita */}
                            <ellipse cx="458" cy="29" rx="15" ry="6.5" fill="#334155" />
                            <ellipse cx="478" cy="31" rx="10" ry="5" fill="#1E293B" />
                            <path
                              d="M424 31C424 24 434 20 439 27C441 30 438 33 431 33C426 33 424 32 424 31Z"
                              fill="#FDE68A"
                              fillOpacity="0.85"
                            />
                            <circle cx="432" cy="28" r="2.2" fill="#FFFBEB" />

                            {/* Pequena estrela-do-mar sobre a areia */}
                            <path
                              d="M525 25L527.2 28.8L531.5 29.4L528.3 32.3L529.1 36.5L525 34.4L520.9 36.5L521.7 32.3L518.5 29.4L522.8 28.8Z"
                              fill="#FB923C"
                              fillOpacity="0.9"
                            />

                            <defs>
                              <linearGradient id="sandGrad" x1="300" y1="14" x2="300" y2="42" gradientUnits="userSpaceOnUse">
                                <stop stopColor="#1E3A5F" stopOpacity="0.95" />
                                <stop offset="1" stopColor="#0B1B34" />
                              </linearGradient>
                              <linearGradient id="sandGradFront" x1="300" y1="20" x2="300" y2="42" gradientUnits="userSpaceOnUse">
                                <stop stopColor="#264B78" stopOpacity="0.85" />
                                <stop offset="1" stopColor="#071326" />
                              </linearGradient>
                            </defs>
                          </svg>
                        </div>

                        {/* Dois peixinhos nadando suavemente pela água (e subindo para comer quando a ração cai!) */}
                        {waterLevelPct > 20 && (
                          <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden">
                            {/* Peixinho 1 (Laranja/Dourado) */}
                            <div
                              onAnimationEnd={(e) => {
                                if (e.animationName === 'fishEatOne') {
                                  finishFeedingCycle();
                                }
                              }}
                              className={`absolute ${
                                feedNowCommand ? 'animate-fish-eat-1' : 'top-[34%] animate-fish-1'
                              }`}
                            >
                              <svg
                                width="34"
                                height="20"
                                viewBox="0 0 34 20"
                                fill="none"
                                className="drop-shadow-[0_2px_6px_rgba(251,146,60,0.45)]"
                              >
                                {/* Cauda animada */}
                                <path
                                  d="M7 10L1 4V16L7 10Z"
                                  fill="#FB923C"
                                  className={feedNowCommand ? 'animate-fish-tail-fast' : 'animate-fish-tail'}
                                />
                                {/* Barbatana dorsal */}
                                <path d="M15 4C17 1 21 1 22 4.5" fill="#F97316" />
                                {/* Corpo */}
                                <ellipse cx="19" cy="10" rx="11" ry="6" fill="url(#fishGrad1)" />
                                {/* Listras sutis */}
                                <path
                                  d="M16 4.5C17.5 8 17.5 12 16 15.5"
                                  stroke="#FFF7ED"
                                  strokeWidth="1.5"
                                  strokeLinecap="round"
                                  strokeOpacity="0.65"
                                />
                                <path
                                  d="M21 4.5C22.2 8 22.2 12 21 15.5"
                                  stroke="#FFF7ED"
                                  strokeWidth="1.3"
                                  strokeLinecap="round"
                                  strokeOpacity="0.5"
                                />
                                {/* Olho */}
                                <circle cx="25.5" cy="8.5" r="1.6" fill="#0F172A" />
                                <circle cx="26" cy="8" r="0.6" fill="#FFFFFF" />
                                {/* Boquinha abrindo quando está comendo */}
                                {feedNowCommand && (
                                  <circle cx="29.2" cy="10.2" r="1.3" fill="#7C2D12" />
                                )}
                                {/* Gorro natalino no peixinho laranja */}
                                {christmasMode && (
                                  <g transform="translate(13, -1)">
                                    <path d="M2 5C4 0.5 9 -0.5 12 2.5C10 4 9.5 5 9.5 5.5Z" fill="#DC2626" />
                                    <rect x="1.5" y="4.5" width="9" height="2" rx="1" fill="#F8FAFC" />
                                    <circle cx="12.2" cy="2.6" r="1.3" fill="#F8FAFC" />
                                  </g>
                                )}
                                <defs>
                                  <linearGradient id="fishGrad1" x1="8" y1="4" x2="30" y2="16" gradientUnits="userSpaceOnUse">
                                    <stop stopColor="#FDBA74" />
                                    <stop offset="0.5" stopColor="#FB923C" />
                                    <stop offset="1" stopColor="#EA580C" />
                                  </linearGradient>
                                </defs>
                              </svg>
                            </div>

                            {/* Peixinho 2 (Azul Neon / Ciano) */}
                            <div
                              onAnimationEnd={(e) => {
                                if (e.animationName === 'fishEatTwo') {
                                  finishFeedingCycle();
                                }
                              }}
                              className={`absolute ${
                                feedNowCommand ? 'animate-fish-eat-2' : 'top-[66%] animate-fish-2'
                              }`}
                            >
                              <svg
                                width="30"
                                height="18"
                                viewBox="0 0 34 20"
                                fill="none"
                                className="drop-shadow-[0_2px_6px_rgba(56,189,248,0.5)]"
                              >
                                {/* Cauda animada */}
                                <path
                                  d="M7 10L1 4.5V15.5L7 10Z"
                                  fill="#38BDF8"
                                  className={feedNowCommand ? 'animate-fish-tail-fast' : 'animate-fish-tail'}
                                />
                                {/* Barbatana dorsal */}
                                <path d="M15 4.5C17 1.5 20.5 1.5 22 4.8" fill="#0284C7" />
                                {/* Corpo */}
                                <ellipse cx="19" cy="10" rx="10.5" ry="5.5" fill="url(#fishGrad2)" />
                                {/* Faixa luminosa neon */}
                                <path
                                  d="M11 9.5H25"
                                  stroke="#E0F2FE"
                                  strokeWidth="1.6"
                                  strokeLinecap="round"
                                  strokeOpacity="0.8"
                                />
                                {/* Olho */}
                                <circle cx="25.5" cy="8.5" r="1.5" fill="#0F172A" />
                                <circle cx="26" cy="8" r="0.55" fill="#FFFFFF" />
                                {/* Boquinha abrindo quando está comendo */}
                                {feedNowCommand && (
                                  <circle cx="28.8" cy="10.2" r="1.2" fill="#082F49" />
                                )}
                                {/* Gorro natalino no peixinho azul */}
                                {christmasMode && (
                                  <g transform="translate(13, -0.5)">
                                    <path d="M2 5C4 0.5 9 -0.5 12 2.5C10 4 9.5 5 9.5 5.5Z" fill="#DC2626" />
                                    <rect x="1.5" y="4.5" width="9" height="2" rx="1" fill="#F8FAFC" />
                                    <circle cx="12.2" cy="2.6" r="1.3" fill="#F8FAFC" />
                                  </g>
                                )}
                                <defs>
                                  <linearGradient id="fishGrad2" x1="8" y1="4" x2="30" y2="16" gradientUnits="userSpaceOnUse">
                                    <stop stopColor="#67E8F9" />
                                    <stop offset="0.55" stopColor="#38BDF8" />
                                    <stop offset="1" stopColor="#0284C7" />
                                  </linearGradient>
                                </defs>
                              </svg>
                            </div>
                          </div>
                        )}

                        {/* Bombinha submersa clicável no canto inferior esquerdo (ativa/desativa a bomba ao clicar) */}
                        <div className="absolute bottom-2.5 left-3.5 z-30 pointer-events-none flex items-end">
                          {/* Ventosas de fixação no vidro esquerdo */}
                          <div className="flex flex-col gap-1.5 mr-0.5 mb-1">
                            <span className="w-1 h-2 rounded-l-full bg-slate-300/70" />
                            <span className="w-1 h-2 rounded-l-full bg-slate-300/70" />
                          </div>

                          {/* Corpo da bombinha submersa como botão */}
                          <button
                            type="button"
                            onClick={handleTogglePump}
                            aria-label={pumpRelayOn ? 'Desligar Bomba' : 'Ligar Bomba'}
                            className={`pointer-events-auto cursor-pointer relative flex items-center transition-transform duration-200 hover:scale-105 active:scale-95 focus:outline-none ${pumpRelayOn ? 'animate-pump-hum' : ''}`}
                          >
                            {/* Conector superior onde encaixa a mangueirinha de ar */}
                            <div
                              className={`absolute -top-2 left-2.5 w-2 h-2.5 rounded-t-sm border transition-all duration-300 ${
                                pumpRelayOn
                                  ? 'bg-sky-300 border-white/60 shadow-[0_0_6px_rgba(125,211,252,0.8)]'
                                  : 'bg-slate-600 border-white/25'
                              }`}
                            />

                            <div
                              className={`w-9 h-7 rounded-lg bg-gradient-to-br from-slate-700 via-slate-800 to-slate-950 border flex flex-col items-center justify-between p-1 transition-all duration-300 ${
                                pumpRelayOn
                                  ? 'border-sky-300/50 shadow-[0_0_16px_rgba(56,189,248,0.4)]'
                                  : 'border-slate-500/40 opacity-85'
                              }`}
                            >
                              {/* Grades de sucção */}
                              <div className="w-full flex justify-between items-center px-0.5">
                                <div className="space-y-0.5">
                                  <span className={`block w-3 h-[1.5px] rounded-full ${pumpRelayOn ? 'bg-sky-300/60' : 'bg-slate-400/40'}`} />
                                  <span className={`block w-3 h-[1.5px] rounded-full ${pumpRelayOn ? 'bg-sky-300/60' : 'bg-slate-400/40'}`} />
                                  <span className={`block w-3 h-[1.5px] rounded-full ${pumpRelayOn ? 'bg-sky-300/60' : 'bg-slate-400/40'}`} />
                                </div>
                                {/* LED indicador de status da bomba */}
                                <span
                                  className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
                                    pumpRelayOn
                                      ? 'bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse'
                                      : 'bg-slate-500/70'
                                  }`}
                                />
                              </div>
                              <span className="text-[6px] font-mono-code tracking-tighter text-sky-200/80 uppercase leading-none">
                                O₂
                              </span>
                            </div>

                            {/* Bico difusor lateral de onde saem as bolhas */}
                            <div
                              className={`relative -top-1.5 -ml-0.5 w-3.5 h-2.5 rounded-r-md border transition-all duration-300 ${
                                pumpRelayOn
                                  ? 'bg-gradient-to-r from-sky-400 to-cyan-200 border-white/70 shadow-[0_0_14px_rgba(125,211,252,0.9)]'
                                  : 'bg-gradient-to-r from-slate-600 to-slate-500 border-white/25'
                              }`}
                            >
                              {/* Coluna intensa e brilhante de bolhas saindo do bico apenas quando a bomba está ligada */}
                              {pumpRelayOn && waterLevelPct > 5 && (
                                <div className="absolute -top-1.5 left-2 w-24 h-52 pointer-events-none">
                                  <span
                                    style={{ '--duration': '1.8s', '--delay': '0s', '--sway': '8px', left: '0px' }}
                                    className="bubble absolute bottom-0 w-3 h-3 rounded-full"
                                  />
                                  <span
                                    style={{ '--duration': '2.2s', '--delay': '0.2s', '--sway': '16px', left: '4px' }}
                                    className="bubble absolute bottom-0 w-2 h-2 rounded-full"
                                  />
                                  <span
                                    style={{ '--duration': '1.6s', '--delay': '0.45s', '--sway': '-5px', left: '1px' }}
                                    className="bubble absolute bottom-0 w-3.5 h-3.5 rounded-full"
                                  />
                                  <span
                                    style={{ '--duration': '2.4s', '--delay': '0.7s', '--sway': '20px', left: '6px' }}
                                    className="bubble absolute bottom-0 w-2.5 h-2.5 rounded-full"
                                  />
                                  <span
                                    style={{ '--duration': '1.9s', '--delay': '0.95s', '--sway': '12px', left: '2px' }}
                                    className="bubble absolute bottom-0 w-3 h-3 rounded-full"
                                  />
                                  <span
                                    style={{ '--duration': '2.1s', '--delay': '1.2s', '--sway': '3px', left: '0px' }}
                                    className="bubble absolute bottom-0 w-2 h-2 rounded-full"
                                  />
                                  <span
                                    style={{ '--duration': '1.75s', '--delay': '1.45s', '--sway': '14px', left: '4px' }}
                                    className="bubble absolute bottom-0 w-3.5 h-3.5 rounded-full"
                                  />
                                  <span
                                    style={{ '--duration': '2.3s', '--delay': '1.7s', '--sway': '22px', left: '7px' }}
                                    className="bubble absolute bottom-0 w-2.5 h-2.5 rounded-full"
                                  />
                                  <span
                                    style={{ '--duration': '1.95s', '--delay': '1.95s', '--sway': '9px', left: '3px' }}
                                    className="bubble absolute bottom-0 w-3 h-3 rounded-full"
                                  />
                                </div>
                              )}
                            </div>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Indicador Central */}
                    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center pointer-events-none drop-shadow-md">
                      <span className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight">
                        {waterLevelPct !== null ? `${waterLevelPct}%` : '--'}
                      </span>
                      {waterVolumeLiters !== null && (
                        <span className="text-xs font-medium text-sky-100 bg-[#040B16]/65 backdrop-blur-md px-3.5 py-1 rounded-full mt-1.5 border border-white/15">
                          Volume: {waterVolumeLiters} L
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Métricas do Aquário */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-[#040B16]/55 border border-white/[0.07] rounded-2xl p-3.5 text-center">
                    <span className="text-[11px] text-sky-200/65 block">Nível Atual</span>
                    <span className="text-base font-bold text-sky-300 font-mono-code mt-0.5 block">
                      {waterLevelPct !== null ? `${waterLevelPct}%` : '--'}
                    </span>
                  </div>
                  <div className="bg-[#040B16]/55 border border-white/[0.07] rounded-2xl p-3 sm:p-3.5 text-center">
                    <span className="text-[11px] text-sky-200/65 block">Volume Atual</span>
                    <span className="text-sm sm:text-base font-bold text-white font-mono-code mt-0.5 block">
                      {waterVolumeLiters !== null ? `${waterVolumeLiters} / ${maxVolumeLiters} L` : `-- / ${maxVolumeLiters} L`}
                    </span>
                  </div>
                </div>
              </div>

              {/* COLUNA DIREITA (6 cols): DISPLAY LCD + TEMPERATURA */}
              <div className="lg:col-span-6 flex flex-col gap-4 sm:gap-6">
                {/* CARD: DISPLAY LCD */}
                <div className="clean-card rounded-2xl sm:rounded-3xl p-4 sm:p-6 animate-fade-up delay-75">
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-2xl bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center text-emerald-300 shrink-0">
                        <Monitor className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-base font-bold text-white">Display LCD</h3>
                        <p className="text-[11px] sm:text-xs text-sky-200/65 truncate">
                          {activeCfg.lcdCarousel ? 'Alternância automática ativa' : 'Espelhamento em tempo real'}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setDraftConfig(config);
                        setWizardStep(3);
                        setActiveTab('setup');
                      }}
                      className="text-xs text-sky-300 hover:text-white flex items-center gap-1 shrink-0 transition-transform hover:translate-x-0.5"
                    >
                      Personalizar <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Moldura do Display LCD */}
                  <div className="rounded-2xl bg-[#040A14] border border-white/10 p-2.5 sm:p-3.5 shadow-inner">
                    <div className="rounded-xl bg-gradient-to-b from-[#0C352A] to-[#07241C] border border-emerald-400/35 px-3 sm:px-5 py-3 sm:py-4 shadow-[inset_0_0_28px_rgba(16,185,129,0.2)] overflow-x-auto">
                      <div className="font-mono-code text-sm min-[400px]:text-base sm:text-2xl font-bold tracking-[0.1em] sm:tracking-[0.18em] text-emerald-200 drop-shadow-[0_0_8px_rgba(110,231,183,0.5)] whitespace-pre transition-all duration-300">
                        {lcdLine0}
                      </div>
                      <div className="font-mono-code text-sm min-[400px]:text-base sm:text-2xl font-bold tracking-[0.1em] sm:tracking-[0.18em] text-emerald-200 drop-shadow-[0_0_8px_rgba(110,231,183,0.5)] whitespace-pre mt-1.5 transition-all duration-300">
                        {lcdLine1}
                      </div>
                    </div>
                  </div>
                </div>

                {/* CARD: TEMPERATURA */}
                <div className="clean-card rounded-2xl sm:rounded-3xl p-4 sm:p-6 flex-1 flex flex-col justify-between animate-fade-up delay-150">
                  <div>
                    <div className="flex flex-wrap items-start justify-between gap-2.5 sm:gap-4 mb-4 sm:mb-5">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-2xl bg-sky-500/15 border border-sky-400/30 flex items-center justify-center text-sky-300 shrink-0">
                          <Thermometer className="w-5 h-5" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-base font-bold text-white">
                            Temperatura da Água
                          </h3>
                          <p className="text-[11px] sm:text-xs text-sky-200/65">
                            Monitoramento térmico em tempo real
                          </p>
                        </div>
                      </div>

                      <span
                        className={`px-2.5 sm:px-3 py-1 rounded-full text-[11px] sm:text-xs font-semibold border shrink-0 transition-all ${tempStatus.bg} ${tempStatus.color}`}
                      >
                        {tempStatus.label}
                      </span>
                    </div>

                    {/* Mostrador Principal de Temperatura + Barra Térmica Animada */}
                    <div className="bg-[#040B16]/60 border border-white/[0.07] rounded-2xl p-4 sm:p-5 space-y-4">
                      <div className="flex flex-col min-[380px]:flex-row min-[380px]:items-center justify-between gap-3">
                        <div>
                          <span className="text-xs text-sky-200/65 block">
                            Temperatura Atual
                          </span>
                          <span className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight mt-1 block font-mono-code">
                            {temperatureC !== null ? `${Number(temperatureC).toFixed(1)} °C` : '--'}
                          </span>
                        </div>
                        <div className="min-[380px]:text-right text-xs text-sky-200/70 space-y-1.5">
                          <div>
                            Faixa Ideal:{' '}
                            <strong className="text-emerald-300 font-mono-code">
                              {config.tempMinC}°C – {config.tempMaxC}°C
                            </strong>
                          </div>
                          <div>
                            Fahrenheit:{' '}
                            <strong className="text-white font-mono-code">
                              {temperatureC !== null
                                ? `${((Number(temperatureC) * 9) / 5 + 32).toFixed(1)} °F`
                                : '--'}
                            </strong>
                          </div>
                        </div>
                      </div>

                      {/* Barra visual da faixa térmica */}
                      <div className="space-y-1">
                        <div className="h-2 w-full rounded-full bg-[#09182E] overflow-hidden p-0.5 border border-white/5">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-sky-400 via-emerald-400 to-rose-400 transition-all duration-700"
                            style={{
                              width: `${
                                temperatureC !== null
                                  ? Math.max(8, Math.min(100, ((Number(temperatureC) - 15) / 20) * 100))
                                  : 55
                              }%`,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* SEÇÃO INFERIOR: GRÁFICO E LOGS */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 animate-fade-up delay-225">
              {/* Gráfico de Nível e Temperatura (7 cols) */}
              <div className="lg:col-span-7 clean-card rounded-2xl sm:rounded-3xl p-4 sm:p-6">
                <div className="flex items-center justify-between mb-4 sm:mb-6">
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-sky-400" />
                      Histórico de Leituras
                    </h3>
                    <p className="text-[11px] sm:text-xs text-sky-200/65">
                      Evolução recente do nível e temperatura da água
                    </p>
                  </div>
                </div>

                {history.length === 0 ? (
                  <div className="h-48 flex items-center justify-center rounded-2xl bg-[#040B16]/50 border border-white/[0.06] text-xs text-sky-200/55 text-center px-4">
                    Nenhum registro de histórico disponível ainda.
                  </div>
                ) : (
                  <>
                    <div className="h-44 sm:h-48 flex items-end justify-between gap-1.5 sm:gap-3 pt-6 px-1 sm:px-2 border-b border-white/[0.08]">
                      {history.map((point, idx) => {
                        const isLast = idx === history.length - 1;
                        return (
                          <div key={idx} className="flex-1 flex flex-col items-center gap-1.5 sm:gap-2 group min-w-0">
                            <span className="text-[10px] sm:text-[11px] font-mono-code text-sky-200/80 group-hover:text-white transition-colors">
                              {point.level}%
                            </span>
                            <div className="w-full max-w-[42px] h-28 sm:h-32 bg-[#040B16]/70 rounded-t-xl p-0.5 sm:p-1 flex items-end border border-white/[0.07] group-hover:border-sky-400/35 transition-colors">
                              <div
                                style={{ height: `${point.level}%` }}
                                className={`w-full rounded-t-lg transition-all duration-700 ease-out ${
                                  isLast
                                    ? 'bg-gradient-to-t from-[#1A539B] to-sky-400 shadow-lg shadow-sky-400/25'
                                    : 'bg-gradient-to-t from-[#12396B]/80 to-[#1A539B] group-hover:to-sky-400/80'
                                }`}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex justify-between gap-1 sm:gap-2 px-1 sm:px-2 pt-2.5 text-[9px] sm:text-[11px] font-mono-code text-sky-200/65">
                      {history.map((point, idx) => (
                        <div key={idx} className="flex-1 text-center min-w-0 truncate">
                          <div>{point.time}</div>
                          {point.temp !== null && (
                            <div className="text-[9px] sm:text-[10px] text-emerald-300/80">{point.temp}°C</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Últimas Leituras (5 cols) */}
              <div className="lg:col-span-5 clean-card rounded-2xl sm:rounded-3xl p-4 sm:p-6 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-4">
                    <div className="min-w-0">
                      <h3 className="text-base font-bold text-white flex items-center gap-2">
                        <Activity className="w-4 h-4 text-sky-400 shrink-0" />
                        Últimas Leituras
                      </h3>
                      <p className="text-[11px] sm:text-xs text-sky-200/65">Eventos recentes do aquário</p>
                    </div>
                    <button
                      onClick={() => setActiveTab('history')}
                      className="text-xs text-sky-300 hover:text-white flex items-center gap-1 shrink-0 transition-transform hover:translate-x-0.5"
                    >
                      Ver todos <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {logs.length === 0 ? (
                    <div className="h-44 flex items-center justify-center rounded-2xl bg-[#040B16]/50 border border-white/[0.06] text-xs text-sky-200/55 text-center px-4">
                      Nenhuma leitura registrada ainda.
                    </div>
                  ) : (
                    <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                      {logs.slice(0, 5).map((log) => (
                        <div
                          key={log.id}
                          className="bg-[#040B16]/60 hover:bg-[#08172E]/70 border border-white/[0.07] hover:border-sky-400/25 rounded-2xl p-3 flex items-start gap-3 transition-all duration-200"
                        >
                          <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 bg-sky-500/15 text-sky-300 border border-sky-400/25">
                            <Waves className="w-4 h-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-white leading-snug break-words">
                              {log.message}
                            </p>
                            <div className="flex items-center justify-end mt-1 text-[10px] text-sky-200/55">
                              <span className="font-mono-code">{log.time}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            ABA DE CONFIGURAÇÕES (LIMPA E ORGANIZADA)
           =================================================================== */}
        {activeTab === 'setup' && (
          <div className="clean-card rounded-2xl sm:rounded-3xl overflow-hidden animate-fade-up">
            {/* Cabeçalho Limpo + Abas Horizontais */}
            <div className="bg-[#050C17]/75 border-b border-white/[0.06] px-4 py-4 sm:px-6 sm:py-5 flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3 sm:gap-3.5 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#1A539B] to-sky-500 border border-sky-300/30 flex items-center justify-center text-white shadow-md shadow-sky-500/20 shrink-0">
                    <Settings className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
                      Configurações do Aquário
                    </h2>
                    <p className="text-[11px] sm:text-xs text-sky-200/70">
                      Capacidade útil calculada: <strong className="text-emerald-300 font-mono-code">{maxVolumeLiters} L</strong> ({TANK_LENGTH_CM}×{TANK_WIDTH_CM}×{TANK_HEIGHT_CM} cm)
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 w-full sm:w-auto">
                  <button
                    onClick={() => setActiveTab('dashboard')}
                    className="inline-flex items-center justify-center gap-1.5 px-3 sm:px-3.5 py-2 rounded-xl bg-white/[0.04] hover:bg-[#1A539B]/35 text-xs font-semibold text-sky-200 hover:text-white border border-white/[0.08] hover:border-sky-400/40 transition-all duration-300 active:scale-[0.98]"
                  >
                    <ArrowLeft className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <span>Voltar ao Painel</span>
                  </button>
                  <button
                    onClick={handleResetFactoryDefaults}
                    className="inline-flex items-center justify-center gap-1.5 px-3 sm:px-3.5 py-2 rounded-xl bg-white/[0.03] hover:bg-rose-500/15 text-xs font-medium text-sky-200/80 hover:text-rose-200 border border-white/[0.08] hover:border-rose-400/40 transition-all duration-300 active:scale-[0.98]"
                  >
                    <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                    <span>Restaurar Padrão</span>
                  </button>
                  <button
                    onClick={handleSaveWizardConfig}
                    className="col-span-2 sm:col-span-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 sm:py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 text-xs font-bold shadow-lg shadow-emerald-500/20 transition-all duration-300 hover:-translate-y-0.5 active:scale-[0.98]"
                  >
                    <Save className="w-4 h-4 shrink-0" />
                    <span>Salvar Configurações</span>
                  </button>
                </div>
              </div>

              {/* Sub-abas limpas de Configuração */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-2 p-1 rounded-2xl bg-[#040912]/80 border border-white/[0.06]">
                {wizardSteps.map((item) => {
                  const Icon = item.icon;
                  const active = wizardStep === item.step;
                  return (
                    <button
                      key={item.step}
                      type="button"
                      onClick={() => setWizardStep(item.step)}
                      className={`p-2 sm:p-2.5 rounded-xl text-[11px] sm:text-xs font-semibold flex items-center justify-center gap-1.5 sm:gap-2 transition-all duration-300 ${
                        active
                          ? 'bg-gradient-to-r from-[#1A539B] to-sky-600 text-white shadow-md shadow-sky-500/20 scale-[1.01]'
                          : 'text-sky-200/70 hover:bg-white/[0.04] hover:text-white'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                      <span className="truncate">{item.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {wifiPortalCommandSent && (
              <div className="mx-4 sm:mx-8 mt-4 sm:mt-5 p-3.5 sm:p-4 rounded-2xl bg-emerald-500/15 border border-emerald-400/40 flex items-start gap-3 text-emerald-200 animate-fade-up">
                <Radio className="w-5 h-5 text-emerald-300 shrink-0 mt-0.5 animate-pulse" />
                <div className="space-y-1 text-xs">
                  <div className="font-bold text-emerald-300 flex items-center gap-2 flex-wrap">
                    <span>Comando de Configuração do ESP32 Ativado!</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-400/20 text-emerald-300 font-mono-code font-bold">10.0.0.1</span>
                  </div>
                  <p className="text-emerald-200/80 leading-relaxed">
                    O ESP32 abriu o ponto de acesso Wi-Fi <strong className="text-white font-mono-code">NETUNO-SETUP</strong>. Se deseja alterar o Wi-Fi em que o ESP32 se conecta, conecte seu aparelho à rede <strong className="text-white font-mono-code">NETUNO-SETUP</strong> e acesse <strong className="text-white font-mono-code">http://10.0.0.1</strong>. As medidas e parâmetros também podem ser ajustados nas abas abaixo.
                  </p>
                </div>
              </div>
            )}

            {saveSuccess && (
              <div className="bg-emerald-500/15 border-b border-emerald-400/30 px-4 sm:px-6 py-2.5 flex items-center justify-center gap-2 text-xs font-semibold text-emerald-200 animate-scale-in">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Configurações salvas com sucesso!</span>
              </div>
            )}

            <div className="p-4 sm:p-8 space-y-5 sm:space-y-6">
              {/* ABA 1: ACESSO & DIMENSÕES DO AQUÁRIO */}
              {wizardStep === 1 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 animate-fade-up">
                  {/* Acesso do ESP32 */}
                  <div className="bg-[#050C17]/75 border border-white/[0.07] rounded-2xl p-4 sm:p-5 space-y-4">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                      Credenciais de Acesso do ESP32
                    </h3>

                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-semibold text-sky-200/80 mb-1">
                          Usuário do ESP32
                        </label>
                        <input
                          type="text"
                          readOnly
                          value={activeDeviceUsername}
                          className="w-full bg-[#091628]/80 border border-white/[0.08] rounded-xl px-3.5 py-2 text-sm font-mono-code text-emerald-300 cursor-not-allowed"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-sky-200/80 mb-1">
                          Senha de Acesso no Site
                        </label>
                        <div className="relative">
                          <input
                            type={showWifiPassword ? 'text' : 'password'}
                            maxLength={32}
                            value={draftConfig.devicePassword ?? authDevice?.password ?? ''}
                            onChange={(e) =>
                              setDraftConfig({ ...draftConfig, devicePassword: e.target.value })
                            }
                            placeholder="Senha deste ESP32"
                            className="w-full bg-[#091628] border border-white/[0.1] rounded-xl pl-3.5 pr-10 py-2 text-sm font-mono-code text-white focus:outline-none focus:border-sky-400 transition-colors"
                          />
                          <button
                            type="button"
                            onClick={() => setShowWifiPassword((prev) => !prev)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-sky-300/70 hover:text-white transition-colors"
                          >
                            {showWifiPassword ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>

                      <div className="pt-2 text-[11px] text-sky-200/70">
                        Para trocar o Wi-Fi do ESP32, use o botão <strong>ESP32</strong> / <strong>Abrir Painel no ESP32</strong> no topo da página e conecte-se na rede <span className="font-mono-code text-sky-300">NETUNO-SETUP</span> (<span className="font-mono-code text-emerald-300">10.0.0.1</span>).
                      </div>
                    </div>
                  </div>

                  {/* Dimensões e Litragem */}
                  <div className="bg-[#050C17]/75 border border-white/[0.07] rounded-2xl p-4 sm:p-5 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        <Droplets className="w-4 h-4 text-sky-400 shrink-0" />
                        Medidas do Aquário
                      </h3>
                      <span className="text-xs font-mono-code font-bold text-emerald-300 bg-emerald-500/15 border border-emerald-400/30 px-2.5 py-1 rounded-lg">
                        Volume Útil: {maxVolumeLiters} L
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="col-span-2">
                        <label className="block text-xs font-semibold text-sky-200/80 mb-1">
                          Nome do Aquário
                        </label>
                        <input
                          type="text"
                          maxLength={30}
                          value={draftConfig.aquariumName}
                          onChange={(e) =>
                            setDraftConfig({ ...draftConfig, aquariumName: e.target.value })
                          }
                          className="w-full bg-[#091628] border border-white/[0.1] rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-sky-400 transition-colors"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-sky-200/80 mb-1">
                          Comprimento (cm)
                        </label>
                        <input
                          type="number"
                          min={10}
                          max={300}
                          value={draftConfig.lengthCm}
                          onChange={(e) =>
                            setDraftConfig({ ...draftConfig, lengthCm: Number(e.target.value) })
                          }
                          className="w-full bg-[#091628] border border-white/[0.1] rounded-xl px-3.5 py-2 text-sm font-mono-code text-white focus:outline-none focus:border-sky-400 transition-colors"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-sky-200/80 mb-1">
                          Largura (cm)
                        </label>
                        <input
                          type="number"
                          min={10}
                          max={200}
                          value={draftConfig.widthCm}
                          onChange={(e) =>
                            setDraftConfig({ ...draftConfig, widthCm: Number(e.target.value) })
                          }
                          className="w-full bg-[#091628] border border-white/[0.1] rounded-xl px-3.5 py-2 text-sm font-mono-code text-white focus:outline-none focus:border-sky-400 transition-colors"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-sky-200/80 mb-1">
                          Altura Total (cm)
                        </label>
                        <input
                          type="number"
                          min={10}
                          max={150}
                          value={draftConfig.heightCm}
                          onChange={(e) =>
                            setDraftConfig({ ...draftConfig, heightCm: Number(e.target.value) })
                          }
                          className="w-full bg-[#091628] border border-white/[0.1] rounded-xl px-3.5 py-2 text-sm font-mono-code text-white focus:outline-none focus:border-sky-400 transition-colors"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-sky-200/80 mb-1">
                          Margem Sensor (cm)
                        </label>
                        <input
                          type="number"
                          min={2}
                          max={15}
                          value={draftConfig.sensorOffsetCm}
                          onChange={(e) =>
                            setDraftConfig({
                              ...draftConfig,
                              sensorOffsetCm: Math.max(2, Number(e.target.value)),
                            })
                          }
                          className="w-full bg-[#091628] border border-white/[0.1] rounded-xl px-3.5 py-2 text-sm font-mono-code text-white focus:outline-none focus:border-sky-400 transition-colors"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ABA 2: NÍVEIS DE ÁGUA & TEMPERATURA IDEAL */}
              {wizardStep === 2 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-fade-up">
                  {/* Limites de Nível */}
                  <div className="bg-[#050C17]/75 border border-white/[0.07] rounded-2xl p-5 space-y-4">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <Waves className="w-4 h-4 text-sky-400" />
                      Alertas de Nível da Água
                    </h3>

                    <div className="space-y-4">
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-semibold text-rose-300">Nível Crítico (Repor Água)</span>
                          <span className="font-mono-code font-bold text-rose-400">
                            {draftConfig.criticalLevelPct}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min={15}
                          max={50}
                          value={draftConfig.criticalLevelPct}
                          onChange={(e) =>
                            setDraftConfig({
                              ...draftConfig,
                              criticalLevelPct: Number(e.target.value),
                            })
                          }
                          className="w-full accent-rose-500 cursor-pointer"
                        />
                      </div>

                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-semibold text-amber-300">Nível de Atenção (Baixo)</span>
                          <span className="font-mono-code font-bold text-amber-300">
                            {draftConfig.warningLevelPct}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min={50}
                          max={85}
                          value={draftConfig.warningLevelPct}
                          onChange={(e) =>
                            setDraftConfig({
                              ...draftConfig,
                              warningLevelPct: Number(e.target.value),
                            })
                          }
                          className="w-full accent-amber-400 cursor-pointer"
                        />
                      </div>

                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-semibold text-sky-300">Alerta Muito Cheio</span>
                          <span className="font-mono-code font-bold text-sky-300">
                            {draftConfig.maxAlertLevelPct}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min={85}
                          max={99}
                          value={draftConfig.maxAlertLevelPct}
                          onChange={(e) =>
                            setDraftConfig({
                              ...draftConfig,
                              maxAlertLevelPct: Number(e.target.value),
                            })
                          }
                          className="w-full accent-sky-400 cursor-pointer"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Temperatura Ideal */}
                  <div className="bg-[#050C17]/75 border border-white/[0.07] rounded-2xl p-5 space-y-4">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <Thermometer className="w-4 h-4 text-emerald-400" />
                      Faixa de Temperatura Ideal
                    </h3>

                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: 'Tropical', sub: '24–28°C', min: 24, max: 28 },
                        { label: 'Comunitário', sub: '22–29°C', min: 22, max: 29 },
                        { label: 'Água Fria', sub: '18–23°C', min: 18, max: 23 },
                      ].map((preset) => {
                        const selected =
                          Number(draftConfig.tempMinC) === preset.min &&
                          Number(draftConfig.tempMaxC) === preset.max;
                        return (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() =>
                              setDraftConfig({
                                ...draftConfig,
                                tempMinC: preset.min,
                                tempMaxC: preset.max,
                              })
                            }
                            className={`p-2.5 rounded-xl border text-center transition-all duration-300 ${
                              selected
                                ? 'bg-gradient-to-br from-[#1A539B] to-sky-600 border-sky-300/60 text-white shadow-md shadow-sky-500/20'
                                : 'bg-[#091628] border-white/[0.08] text-sky-200 hover:bg-white/[0.05]'
                            }`}
                          >
                            <div className="text-xs font-bold">{preset.label}</div>
                            <div className="text-[11px] text-emerald-300 font-mono-code">
                              {preset.sub}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <div>
                        <label className="block text-xs font-semibold text-sky-300 mb-1">
                          Mínima (°C)
                        </label>
                        <input
                          type="number"
                          step="0.5"
                          min={10}
                          max={32}
                          value={draftConfig.tempMinC}
                          onChange={(e) =>
                            setDraftConfig({ ...draftConfig, tempMinC: Number(e.target.value) })
                          }
                          className="w-full bg-[#091628] border border-white/[0.1] rounded-xl px-3.5 py-2 text-sm font-bold font-mono-code text-white focus:outline-none focus:border-sky-400"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-rose-300 mb-1">
                          Máxima (°C)
                        </label>
                        <input
                          type="number"
                          step="0.5"
                          min={15}
                          max={35}
                          value={draftConfig.tempMaxC}
                          onChange={(e) =>
                            setDraftConfig({ ...draftConfig, tempMaxC: Number(e.target.value) })
                          }
                          className="w-full bg-[#091628] border border-white/[0.1] rounded-xl px-3.5 py-2 text-sm font-bold font-mono-code text-white focus:outline-none focus:border-sky-400"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ABA 3: DISPLAY LCD */}
              {wizardStep === 3 && (
                <div className="space-y-5 animate-fade-up">
                  <div className="rounded-2xl bg-[#040A14] border border-white/[0.08] p-3 sm:p-4 shadow-inner">
                    <div className="text-[11px] text-sky-300/80 mb-2 flex justify-between gap-2">
                      <span>Prévia do Display LCD (16x2)</span>
                      {draftConfig.lcdCarousel && (
                        <span className="text-emerald-300 font-semibold">Carrossel Ativo (4s)</span>
                      )}
                    </div>
                    <div className="rounded-xl bg-gradient-to-b from-[#0E3B2E] to-[#092920] border-2 border-emerald-400/40 px-3 sm:px-5 py-3 sm:py-3.5 shadow-[0_0_25px_rgba(16,185,129,0.15)] overflow-x-auto">
                      <div className="font-mono-code text-sm min-[400px]:text-base sm:text-2xl font-bold tracking-[0.1em] sm:tracking-[0.18em] text-emerald-200 whitespace-pre">
                        {lcdLine0}
                      </div>
                      <div className="font-mono-code text-sm min-[400px]:text-base sm:text-2xl font-bold tracking-[0.1em] sm:tracking-[0.18em] text-emerald-200 whitespace-pre mt-1">
                        {lcdLine1}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-sky-200/80 mb-1">
                        Linha 1 (Superior)
                      </label>
                      <select
                        value={draftConfig.lcdLine1Mode}
                        onChange={(e) =>
                          setDraftConfig({ ...draftConfig, lcdLine1Mode: e.target.value })
                        }
                        className="w-full bg-[#050C17] border border-white/[0.1] rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-sky-400"
                      >
                        <option value="water_pct">Nível da Água (%)</option>
                        <option value="volume_liters">Volume Atual (Litros)</option>
                        <option value="rtc_time">Horário do RTC</option>
                        <option value="custom_title">Texto Personalizado</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-sky-200/80 mb-1">
                        Linha 2 (Inferior)
                      </label>
                      <select
                        value={draftConfig.lcdLine2Mode}
                        onChange={(e) =>
                          setDraftConfig({ ...draftConfig, lcdLine2Mode: e.target.value })
                        }
                        className="w-full bg-[#050C17] border border-white/[0.1] rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-sky-400"
                      >
                        <option value="temp_c">Temperatura (°C)</option>
                        <option value="rtc_time">Horário do RTC</option>
                        <option value="pump_status">Status da Bomba (Ligada / Desligada)</option>
                        <option value="next_feed">Próximo Horário de Comida</option>
                      </select>
                    </div>

                    {draftConfig.lcdLine1Mode === 'custom_title' && (
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-semibold text-sky-200/80 mb-1">
                          Texto Personalizado (Máx. 16 caracteres)
                        </label>
                        <input
                          type="text"
                          maxLength={16}
                          value={draftConfig.lcdCustomText}
                          onChange={(e) =>
                            setDraftConfig({ ...draftConfig, lcdCustomText: e.target.value })
                          }
                          className="w-full bg-[#050C17] border border-white/[0.1] rounded-xl px-3.5 py-2 text-sm font-mono-code uppercase text-white focus:outline-none focus:border-sky-400"
                          placeholder="NETUNO AQUARIO"
                        />
                      </div>
                    )}

                    <div className="sm:col-span-2 bg-[#050C17]/75 border border-white/[0.07] rounded-2xl p-4 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <span className="text-sm font-bold text-white block">
                          Alternar Telas Automaticamente (Carrossel)
                        </span>
                        <span className="text-xs text-sky-200/70">
                          Alterna a cada 4 segundos entre Nível/Temperatura e Volume/Hora.
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setDraftConfig({
                            ...draftConfig,
                            lcdCarousel: !draftConfig.lcdCarousel,
                          })
                        }
                        className={`w-12 h-6 rounded-full p-1 shrink-0 transition-colors duration-300 ${
                          draftConfig.lcdCarousel ? 'bg-emerald-500' : 'bg-slate-700'
                        }`}
                      >
                        <div
                          className={`w-4 h-4 rounded-full bg-white transition-transform duration-300 ${
                            draftConfig.lcdCarousel ? 'translate-x-6' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ABA 4: RTC, BOMBA & ALIMENTADOR */}
              {wizardStep === 4 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 animate-fade-up">
                  <div className="space-y-4 sm:space-y-6">
                    {/* Relógio RTC */}
                    <div className="bg-[#050C17]/75 border border-white/[0.07] rounded-2xl p-4 sm:p-5 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="text-sm font-bold text-white flex items-center gap-2">
                          <Clock className="w-4 h-4 text-sky-400 shrink-0" />
                          Relógio do Módulo RTC
                        </h4>
                        <span className="font-mono-code text-xs font-bold text-emerald-300 shrink-0">
                          {rtcTimeFormatted}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-2.5">
                        <input
                          type="date"
                          value={rtcEditDate}
                          onChange={(e) => setRtcEditDate(e.target.value)}
                          className="w-full min-w-0 bg-[#091628] border border-white/[0.1] rounded-xl px-3 py-2 text-xs font-mono-code text-white focus:outline-none focus:border-sky-400"
                        />
                        <input
                          type="time"
                          step="1"
                          value={rtcEditTime}
                          onChange={(e) => setRtcEditTime(e.target.value)}
                          className="w-full min-w-0 bg-[#091628] border border-white/[0.1] rounded-xl px-3 py-2 text-xs font-mono-code text-white focus:outline-none focus:border-sky-400"
                        />
                      </div>

                      <div className="flex flex-col sm:flex-row gap-2">
                        <button
                          type="button"
                          onClick={() => handleApplyRtcDateTime(null)}
                          className="flex-1 py-2.5 sm:py-2 px-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 text-xs font-extrabold transition-all duration-300 active:scale-[0.98]"
                        >
                          Gravar no RTC
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApplyRtcDateTime(new Date().toISOString())}
                          className="py-2.5 sm:py-2 px-3 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-white text-xs font-bold border border-white/[0.1] transition-all duration-300 active:scale-[0.98]"
                        >
                          Sincronizar Hora Atual
                        </button>
                      </div>

                      {rtcSaveNotice && (
                        <div className="text-xs text-emerald-300 flex items-center gap-1.5 font-semibold animate-scale-in">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Horário atualizado no RTC!
                        </div>
                      )}
                    </div>

                    {/* Bomba de Oxigênio */}
                    <div className="bg-[#050C17]/75 border border-white/[0.07] rounded-2xl p-4 sm:p-5 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h4 className="text-sm font-bold text-white flex items-center gap-2">
                          <Wind className="w-4 h-4 text-sky-400 shrink-0" />
                          Bomba ({pumpRelayOn ? 'Ligada' : 'Desligada'})
                        </h4>
                        <button
                          type="button"
                          onClick={handleTogglePump}
                          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all duration-300 active:scale-[0.98] ${
                            pumpRelayOn
                              ? 'bg-gradient-to-r from-emerald-500 to-teal-400 text-slate-950 shadow-md shadow-emerald-500/20'
                              : 'bg-white/[0.05] hover:bg-white/[0.1] text-white border border-white/[0.1]'
                          }`}
                        >
                          <Power className="w-3.5 h-3.5" />
                          {pumpRelayOn ? 'Desligar Bomba' : 'Ligar Bomba'}
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                        <div>
                          <label className="block text-[11px] text-sky-200/80 mb-1">Modo</label>
                          <select
                            value={draftConfig.pumpMode}
                            onChange={(e) =>
                              setDraftConfig({ ...draftConfig, pumpMode: e.target.value })
                            }
                            className="w-full bg-[#091628] border border-white/[0.1] rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-sky-400"
                          >
                            <option value="auto">Automático</option>
                            <option value="manual">Manual</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] text-sky-200/80 mb-1">
                            Ciclo Ligada (min)
                          </label>
                          <input
                            type="number"
                            min={5}
                            max={240}
                            value={draftConfig.pumpCycleOnMin}
                            onChange={(e) =>
                              setDraftConfig({
                                ...draftConfig,
                                pumpCycleOnMin: Number(e.target.value),
                              })
                            }
                            className="w-full bg-[#091628] border border-white/[0.1] rounded-xl px-2.5 py-2 text-xs font-mono-code text-white focus:outline-none focus:border-sky-400"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] text-sky-200/80 mb-1">
                            Corte Seg. (&lt; %)
                          </label>
                          <input
                            type="number"
                            min={10}
                            max={50}
                            value={draftConfig.pumpSafetyCutoffPct}
                            onChange={(e) =>
                              setDraftConfig({
                                ...draftConfig,
                                pumpSafetyCutoffPct: Number(e.target.value),
                              })
                            }
                            className="w-full bg-[#091628] border border-white/[0.1] rounded-xl px-2.5 py-2 text-xs font-mono-code text-white focus:outline-none focus:border-sky-400"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Alimentador Automático */}
                  <div className="bg-[#050C17]/75 border border-white/[0.07] rounded-2xl p-4 sm:p-5 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="text-sm font-bold text-white flex items-center gap-2">
                        <Utensils className="w-4 h-4 text-sky-400 shrink-0" />
                        Alimentador ({schedules.length}/8 horários)
                      </h4>
                      <button
                        type="button"
                        onClick={() => handleTriggerFeedNow(draftConfig.defaultPortion)}
                        disabled={feedNowCommand}
                        className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all duration-300 active:scale-[0.98] ${
                          feedNowCommand
                            ? 'bg-amber-400 text-slate-950 animate-pulse'
                            : 'bg-gradient-to-r from-[#1A539B] to-sky-500 text-white shadow-md shadow-sky-500/20'
                        }`}
                      >
                        <Utensils className="w-3.5 h-3.5" />
                        {feedNowCommand ? 'Alimentando...' : 'Alimentar Agora'}
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                      {['Leve (3g)', 'Padrão (5g)', 'Generosa (8g)'].map((portion) => (
                        <button
                          key={portion}
                          type="button"
                          onClick={() =>
                            setDraftConfig({ ...draftConfig, defaultPortion: portion })
                          }
                          className={`py-2 px-1.5 sm:px-2.5 rounded-xl text-[11px] sm:text-xs font-semibold border transition-all duration-300 ${
                            draftConfig.defaultPortion === portion
                              ? 'bg-gradient-to-r from-[#1A539B] to-sky-600 border-sky-400/50 text-white shadow-sm'
                              : 'bg-[#091628] border-white/[0.08] text-sky-200/70 hover:bg-white/[0.05]'
                          }`}
                        >
                          {portion}
                        </button>
                      ))}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                      {schedules.map((item) => (
                        <div
                          key={item.id}
                          className="bg-[#091628]/80 border border-white/[0.08] rounded-xl p-2.5 flex items-center justify-between transition-colors hover:border-white/[0.15]"
                        >
                          <div>
                            <span className="text-sm font-extrabold font-mono-code text-white">
                              {item.time}
                            </span>
                            <span className="text-[11px] text-sky-300 block">{item.portion}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleToggleSchedule(item.id)}
                              className={`w-8 h-4 rounded-full p-0.5 transition-colors duration-300 ${
                                item.enabled ? 'bg-emerald-500' : 'bg-slate-700'
                              }`}
                            >
                              <div
                                className={`w-3 h-3 rounded-full bg-white transition-transform duration-300 ${
                                  item.enabled ? 'translate-x-4' : 'translate-x-0'
                                }`}
                              />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteSchedule(item.id)}
                              className="p-1 text-rose-400 hover:text-rose-300 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {schedules.length < 8 && (
                      <form onSubmit={handleAddSchedule} className="grid grid-cols-2 sm:flex gap-2 pt-1">
                        <input
                          type="time"
                          value={newScheduleTime}
                          onChange={(e) => setNewScheduleTime(e.target.value)}
                          className="w-full min-w-0 sm:w-auto bg-[#091628] border border-white/[0.1] rounded-xl px-2.5 py-2 text-xs font-mono-code text-white focus:outline-none focus:border-sky-400"
                        />
                        <select
                          value={newSchedulePortion}
                          onChange={(e) => setNewSchedulePortion(e.target.value)}
                          className="w-full min-w-0 bg-[#091628] border border-white/[0.1] rounded-xl px-2.5 py-2 text-xs text-white sm:flex-1 focus:outline-none focus:border-sky-400"
                        >
                          <option value="Leve (3g)">Leve (3g)</option>
                          <option value="Padrão (5g)">Padrão (5g)</option>
                          <option value="Generosa (8g)">Generosa (8g)</option>
                        </select>
                        <button
                          type="submit"
                          className="col-span-2 sm:col-span-1 justify-center bg-gradient-to-r from-[#1A539B] to-sky-500 hover:from-[#2364B8] hover:to-sky-400 text-white text-xs font-bold px-3.5 py-2.5 sm:py-2 rounded-xl flex items-center gap-1 transition-all duration-300 active:scale-[0.98]"
                        >
                          <Plus className="w-3.5 h-3.5" /> Adicionar
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===================================================================
            ABA 3: HISTÓRICO
           =================================================================== */}
        {activeTab === 'history' && (
          <div className="clean-card rounded-2xl sm:rounded-3xl p-4 sm:p-8 space-y-5 sm:space-y-6 animate-fade-up">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 border-b border-white/[0.06] pb-4 sm:pb-5">
              <div>
                <h3 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2.5 tracking-tight">
                  <Activity className="w-5 h-5 text-sky-400 shrink-0" />
                  Histórico de Eventos
                </h3>
                <p className="text-xs sm:text-sm text-sky-200/70 mt-1">
                  Registro completo das leituras do aquário.
                </p>
              </div>
              <button
                onClick={fetchSupabaseData}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-xs font-semibold text-white border border-white/[0.1] transition-all duration-300 hover:-translate-y-0.5 active:scale-[0.98] w-full sm:w-auto"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Atualizar Agora
              </button>
            </div>

            {logs.length === 0 ? (
              <div className="py-12 text-center text-sm text-sky-200/60 bg-[#050C17]/60 rounded-2xl border border-white/[0.06]">
                Nenhum registro encontrado no histórico.
              </div>
            ) : (
              <div className="space-y-3">
                {logs.map((log, idx) => (
                  <div
                    key={log.id}
                    style={{ animationDelay: `${Math.min(idx * 40, 300)}ms` }}
                    className="bg-[#050C17]/75 border border-white/[0.07] hover:border-sky-400/30 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-all duration-300 hover:-translate-y-0.5 animate-fade-up"
                  >
                    <div className="flex items-center gap-3.5">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-sky-500/15 text-sky-300 border border-sky-400/25">
                        <Waves className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-white">{log.message}</p>
                      </div>
                    </div>
                    <span className="text-xs font-mono-code text-sky-300 bg-white/[0.04] px-3 py-1.5 rounded-lg border border-white/[0.08] self-start sm:self-center">
                      {log.time}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* RODAPÉ */}
      <footer
        className={`border-t backdrop-blur-xl py-5 px-4 sm:px-6 lg:px-8 mt-8 transition-colors ${
          christmasMode ? 'border-amber-400/20 bg-[#05120D]/85' : 'border-white/[0.06] bg-[#040A14]/80'
        }`}
      >
        <div className="max-w-7xl mx-auto flex items-center justify-center gap-2.5 text-xs text-sky-200/60">
          <img
            src="/logo-netuno.jpg"
            alt="Netuno"
            className="w-6 h-6 rounded-md object-cover border border-white/15"
          />
          <span className="font-serif font-bold tracking-widest text-white/90">
            {christmasMode ? 'NETUNO • FELIZ NATAL 🎄' : 'NETUNO'}
          </span>
        </div>
      </footer>
    </div>
  );
}
