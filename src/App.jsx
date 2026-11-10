import React, { useState, useEffect, useCallback } from 'react';
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
  ShieldCheck
} from 'lucide-react';
import { supabase, isSupabaseConfigured } from './lib/supabase';

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
  const [rtcEditDate, setRtcEditDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rtcEditTime, setRtcEditTime] = useState(() =>
    new Date().toTimeString().slice(0, 8)
  );
  const [rtcSaveNotice, setRtcSaveNotice] = useState(false);
  const [wifiPortalCommandSent, setWifiPortalCommandSent] = useState(false);
  const [lastAutoFedMinuteKey, setLastAutoFedMinuteKey] = useState('');

  const [logs, setLogs] = useState([]);
  const [history, setHistory] = useState([]);
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard' | 'setup' | 'history'
  const [carouselTick, setCarouselTick] = useState(0);

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
        .eq('device_username', activeDeviceUsername)
        .catch(() => {});
    }
    setTimeout(() => setFeedNowCommand(false), 3000);
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

    const { data: statusData } = await supabase
      .from('aquarium_status')
      .select('*')
      .eq('device_username', activeDeviceUsername)
      .maybeSingle();

    if (statusData) {
      if (statusData.pump_relay_on !== undefined && statusData.pump_relay_on !== null) {
        setPumpRelayOn(Boolean(statusData.pump_relay_on));
      }
      if (statusData.pump_mode) {
        setPumpMode(statusData.pump_mode);
      }
      if (statusData.feed_now_command !== undefined && statusData.feed_now_command !== null) {
        setFeedNowCommand(Boolean(statusData.feed_now_command));
      }
      if (statusData.feed_now_portion) {
        setFeedNowPortion(statusData.feed_now_portion);
      }

      const espEverSent =
        Number(statusData.distance_cm) > 0 || Number(statusData.water_level_pct) > 0;

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
        const seenAt = statusData.rtc_datetime || statusData.esp_last_seen || statusData.updated_at;
        if (seenAt) {
          setLastSeenIso(seenAt);
          setRtcTimestamp(seenAt);
          const diffSec = Math.max(
            0,
            Math.floor((Date.now() - new Date(seenAt).getTime()) / 1000)
          );
          setEspOnline(diffSec < 30);
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
      .eq('device_username', activeDeviceUsername)
      .order('time', { ascending: true });

    if (scheduleData && scheduleData.length > 0) {
      setSchedules(scheduleData);
    }

    const { data: logData } = await supabase
      .from('telemetry_logs')
      .select('*')
      .eq('device_username', activeDeviceUsername)
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
          if (s.feed_now_command !== undefined && s.feed_now_command !== null) {
            setFeedNowCommand(Boolean(s.feed_now_command));
          }
          if (s.feed_now_portion) {
            setFeedNowPortion(s.feed_now_portion);
          }
          const nowIso = s.rtc_datetime || s.esp_last_seen || new Date().toISOString();
          setLastSeenIso(nowIso);
          setRtcTimestamp(nowIso);
          setEspOnline(true);
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
          .eq('device_username', cleanUser)
          .maybeSingle();

        if (fetchError) {
          setLoginError('Erro ao consultar o banco no Supabase. Verifique se rodou o novo SQL.');
          setLoginLoading(false);
          return;
        }

        if (existingDevice) {
          if (
            existingDevice.device_password &&
            existingDevice.device_password !== cleanPass
          ) {
            setLoginError('Senha incorreta para este ESP32. Verifique a senha cadastrada.');
            setLoginLoading(false);
            return;
          }

          // Caso o ESP32 antigo estivesse sem senha gravada, atualiza
          if (!existingDevice.device_password) {
            await supabase
              .from('aquarium_status')
              .update({ device_password: cleanPass })
              .eq('device_username', cleanUser);
          }

          const sessionData = {
            username: cleanUser,
            password: cleanPass,
            deviceId: existingDevice.device_id || 'ESP32',
          };
          setAuthDevice(sessionData);
          localStorage.setItem('netuno_esp_auth', JSON.stringify(sessionData));
          setConfig((prev) => ({
            ...prev,
            deviceUsername: cleanUser,
            devicePassword: cleanPass,
          }));
          setDraftConfig((prev) => ({
            ...prev,
            deviceUsername: cleanUser,
            devicePassword: cleanPass,
          }));
          setLoginLoading(false);
          return;
        }

        // Se o ESP32 ainda não enviou o primeiro pacote para o Supabase, pré-cadastra o vínculo
        const { data: createdDevice, error: insertError } = await supabase
          .from('aquarium_status')
          .upsert(
            [
              {
                device_username: cleanUser,
                device_password: cleanPass,
                water_level_pct: 0,
                distance_cm: 0,
                temperature_c: 0,
                pump_relay_on: true,
                pump_mode: 'auto',
              },
            ],
            { onConflict: 'device_username' }
          )
          .select()
          .maybeSingle();

        if (insertError) {
          setLoginError(
            'Não foi possível vincular este usuário no Supabase. Confirme se executou o script SQL atualizado.'
          );
          setLoginLoading(false);
          return;
        }

        const sessionData = {
          username: cleanUser,
          password: cleanPass,
          deviceId: createdDevice?.device_id || 'Aguardando ESP32',
        };
        setAuthDevice(sessionData);
        localStorage.setItem('netuno_esp_auth', JSON.stringify(sessionData));
        setConfig((prev) => ({
          ...prev,
          deviceUsername: cleanUser,
          devicePassword: cleanPass,
        }));
        setDraftConfig((prev) => ({
          ...prev,
          deviceUsername: cleanUser,
          devicePassword: cleanPass,
        }));
      } else {
        const sessionData = {
          username: cleanUser,
          password: cleanPass,
          deviceId: 'Modo Local',
        };
        setAuthDevice(sessionData);
        localStorage.setItem('netuno_esp_auth', JSON.stringify(sessionData));
      }
    } catch (err) {
      setLoginError('Falha ao conectar com o servidor.');
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
    if (isSupabaseConfigured && supabase && activeDeviceUsername) {
      await supabase
        .from('aquarium_status')
        .update({ pump_relay_on: next })
        .eq('device_username', activeDeviceUsername);
    }
  };

  const handleTriggerFeedNow = async (portion = draftConfig.defaultPortion) => {
    setFeedNowCommand(true);
    setFeedNowPortion(portion);
    if (isSupabaseConfigured && supabase && activeDeviceUsername) {
      await supabase
        .from('aquarium_status')
        .update({ feed_now_command: true, feed_now_portion: portion })
        .eq('device_username', activeDeviceUsername);
    }
    setTimeout(() => setFeedNowCommand(false), 2500);
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
      setRtcEditDate(d.toISOString().slice(0, 10));
      setRtcEditTime(d.toTimeString().slice(0, 8));
    }

    setRtcTimestamp(targetIso);
    setRtcSaveNotice(true);
    setTimeout(() => setRtcSaveNotice(false), 2500);

    if (isSupabaseConfigured && supabase && activeDeviceUsername) {
      await supabase
        .from('aquarium_status')
        .update({
          rtc_datetime: targetIso,
          rtc_set_command: true,
        })
        .eq('device_username', activeDeviceUsername)
        .catch(() => {});
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

  // Envia apenas o comando para o ESP32 abrir o Ponto de Acesso de configuração inicial (sem abrir nenhuma tela no site)
  const handleSendEspPortalCommand = async () => {
    setWifiPortalCommandSent(true);
    if (isSupabaseConfigured && supabase && activeDeviceUsername) {
      await supabase
        .from('aquarium_status')
        .update({ wifi_setup_command: true })
        .eq('device_username', activeDeviceUsername)
        .catch(() => {});
    }
    setTimeout(() => setWifiPortalCommandSent(false), 3500);
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

  // TELA DE LOGIN PARA ACESSAR O ESP32 ESPECÍFICO
  if (!authDevice) {
    return (
      <div className="min-h-screen flex flex-col justify-between bg-[#050D1A] text-slate-100 selection:bg-[#1A539B] selection:text-white">
        <div className="flex-1 flex items-center justify-center p-4 sm:p-6">
          <div className="w-full max-w-md bg-[#0B1D35]/95 backdrop-blur-xl rounded-3xl border border-[#1A539B]/60 shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-[#081528] via-[#123666] to-[#081528] border-b border-[#1A539B]/50 p-6 text-center">
              <div className="relative mx-auto w-16 h-16 rounded-2xl overflow-hidden border-2 border-sky-300/40 bg-[#1A539B] shadow-lg flex items-center justify-center mb-3">
                <img
                  src="/logo-netuno.jpg"
                  alt="Logo Netuno"
                  className="w-full h-full object-cover scale-105"
                />
              </div>
              <h1 className="font-serif text-2xl font-bold tracking-[0.18em] text-white">
                NETUNO
              </h1>
              <p className="text-xs text-sky-200/80 mt-1">
                Acesso Exclusivo ao seu ESP32 • Monitoramento Inteligente
              </p>
            </div>

            <form onSubmit={handleDeviceLogin} className="p-6 space-y-5">
              <div className="bg-[#06101E]/90 border border-sky-400/30 rounded-2xl p-3.5 text-xs text-sky-200/85 space-y-1">
                <div className="font-bold text-sky-300 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-300 shrink-0" />
                  <span>Como funciona o vínculo com o ESP32:</span>
                </div>
                <p className="leading-relaxed text-[11px] text-sky-200/75">
                  Ao ligar o ESP32 pela primeira vez, conecte-se na rede Wi-Fi{' '}
                  <strong className="text-white font-mono-code">NETUNO-SETUP</strong> e acesse{' '}
                  <strong className="text-emerald-300 font-mono-code">10.0.0.1</strong> para
                  cadastrar seu <strong>Usuário</strong> e <strong>Senha</strong>. Digite os mesmos
                  dados abaixo para acessar seu aquário.
                </p>
              </div>

              {loginError && (
                <div className="bg-rose-500/15 border border-rose-400/40 rounded-xl p-3 text-xs text-rose-200 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{loginError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-sky-200 mb-1.5">
                  Usuário do ESP32
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-sky-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    maxLength={32}
                    value={loginUsername}
                    onChange={(e) => setLoginUsername(e.target.value)}
                    placeholder="Ex: aquario_joao"
                    className="w-full bg-[#06101E] border border-[#1A539B]/70 rounded-xl pl-10 pr-4 py-3 text-sm text-white focus:outline-none focus:border-sky-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-sky-200 mb-1.5">
                  Senha do ESP32
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-sky-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type={showLoginPassword ? 'text' : 'password'}
                    required
                    maxLength={32}
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="Digite a senha cadastrada no ESP32"
                    className="w-full bg-[#06101E] border border-[#1A539B]/70 rounded-xl pl-10 pr-10 py-3 text-sm font-mono-code text-white focus:outline-none focus:border-sky-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLoginPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-sky-300/70 hover:text-white"
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
                className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-[#1A539B] to-sky-500 hover:from-[#2161B2] hover:to-sky-400 text-white text-sm font-extrabold border border-sky-300/40 shadow-lg shadow-[#1A539B]/40 transition flex items-center justify-center gap-2"
              >
                <ShieldCheck className="w-4 h-4" />
                {loginLoading ? 'Conectando ao ESP32...' : 'Acessar Meu ESP32'}
              </button>
            </form>
          </div>
        </div>

        <footer className="border-t border-[#1A539B]/30 bg-[#06101E]/90 py-4 px-4 text-center text-xs text-sky-200/60">
          NETUNO • Autenticação Direta por Dispositivo ESP32
        </footer>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col text-slate-100 selection:bg-[#1A539B] selection:text-white">
      {/* ALERTA DE NÍVEL CRÍTICO */}
      {waterLevelPct !== null && waterLevelPct < Number(config.criticalLevelPct) && (
        <div className="bg-rose-600/90 backdrop-blur-md border-b border-rose-400/40 px-4 py-2.5 text-center text-sm font-medium text-white flex items-center justify-center gap-2 animate-pulse">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            <strong>Alerta de Nível:</strong> O nível da água está crítico ({waterLevelPct}%).
          </span>
        </div>
      )}

      {/* HEADER PRINCIPAL */}
      <header className="sticky top-0 z-30 border-b border-[#1A539B]/40 bg-[#06101E]/85 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="relative group">
              <div className="absolute -inset-1 rounded-2xl bg-gradient-to-tr from-[#1A539B] to-sky-400 opacity-60 blur"></div>
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
                {config.aquariumName} • {TANK_LENGTH_CM} × {TANK_WIDTH_CM} × {TANK_HEIGHT_CM} cm ({maxVolumeLiters} L)
              </p>
            </div>
          </div>

          {/* Navegação Central (oculta se estiver em modo de tela única de setup) */}
          {!exclusiveSetupMode ? (
            <nav className="hidden md:flex items-center bg-[#0B1D35]/90 p-1 rounded-xl border border-[#1A539B]/40">
              {[
                { id: 'dashboard', label: 'Painel Principal', icon: Gauge },
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
          ) : (
            <div className="hidden md:flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/15 border border-amber-400/40 text-amber-200 text-xs font-semibold">
              <Radio className="w-3.5 h-3.5 text-amber-300 animate-pulse" />
              <span>Modo Exclusivo de Configuração Inicial & Wi-Fi Ativo</span>
            </div>
          )}

          {/* Relógio em Tempo Real (RTC) + Botão discreto no canto para enviar comando ao ESP32 */}
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#0B1D35] border border-sky-400/30 text-xs">
              <User className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
              <span className="font-mono-code font-bold text-white">{activeDeviceUsername}</span>
            </div>

            <div className="flex items-center gap-2 text-right">
              <Clock className="w-4 h-4 text-sky-400 shrink-0" />
              <div>
                <div className="font-mono-code text-base sm:text-lg font-extrabold text-white tracking-wider leading-none">
                  {rtcTimeFormatted}
                </div>
                <div className="text-[10px] text-sky-300/80 hidden sm:block mt-0.5">
                  {rtcDateFormatted}
                </div>
              </div>
            </div>

            <button
              onClick={handleSendEspPortalCommand}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition ${
                wifiPortalCommandSent
                  ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300'
                  : 'bg-[#0B1D35] hover:bg-[#1A539B]/70 border-[#1A539B]/60 text-sky-200 hover:text-white'
              }`}
              title="Envia comando para o ESP32 abrir a rede NETUNO-SETUP (10.0.0.1)"
            >
              <Wifi className="w-3.5 h-3.5 text-sky-400" />
              <span className="hidden xl:inline">
                {wifiPortalCommandSent ? 'Comando Enviado ao ESP32!' : 'Portal ESP32'}
              </span>
            </button>

            <button
              onClick={handleDeviceLogout}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#0B1D35] hover:bg-rose-500/20 border border-[#1A539B]/60 hover:border-rose-400/50 text-[11px] font-semibold text-sky-200 hover:text-rose-200 transition"
              title="Logout"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Logout</span>
            </button>
          </div>
        </div>

        {/* Navegação Mobile */}
        {!exclusiveSetupMode && (
          <div className="flex md:hidden border-t border-[#1A539B]/30 bg-[#081528] px-2 py-1.5 justify-around">
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
        )}
      </header>

      {/* CONTEÚDO PRINCIPAL */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-8">
        {/* RESUMO RÁPIDO DOS INDICADORES (Oculto quando está no Modo Exclusivo de Configuração Inicial) */}
        {!exclusiveSetupMode && (
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
                  Nível d'Água
                </span>
                <span className="text-2xl sm:text-3xl font-bold text-white mt-0.5 block">
                  {waterLevelPct !== null ? `${waterLevelPct}%` : '--'}
                </span>
                <span className="text-xs text-sky-300">
                  {waterStatus.label}
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
                  Temperatura
                </span>
                <span className="text-2xl sm:text-3xl font-bold text-emerald-300 mt-0.5 block">
                  {temperatureC !== null ? `${Number(temperatureC).toFixed(1)} °C` : '--'}
                </span>
                <span className="text-xs text-sky-200/80">
                  {tempStatus.label}
                </span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-[#1A539B]/60 border border-sky-300/25 flex items-center justify-center text-sky-200">
                <Thermometer className="w-5 h-5" />
              </div>
            </div>

            {/* Card 3: Bomba de Oxigênio */}
            <div className="bg-[#08172E]/65 backdrop-blur-md border border-white/15 rounded-2xl p-4 flex items-center justify-between">
              <div>
                <span className="text-[11px] uppercase tracking-wider text-sky-200/75 block">
                  Bomba de Oxigênio
                </span>
                <span
                  className={`text-2xl sm:text-3xl font-bold mt-0.5 block ${
                    pumpRelayOn ? 'text-emerald-300' : 'text-amber-300'
                  }`}
                >
                  {pumpRelayOn ? 'Ligada' : 'Desligada'}
                </span>
                <span className="text-xs text-sky-200/80">
                  Modo {pumpMode === 'auto' ? 'Automático' : 'Manual'}
                </span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-[#1A539B]/60 border border-sky-300/25 flex items-center justify-center text-sky-200">
                <Wind className="w-5 h-5" />
              </div>
            </div>

            {/* Card 4: Alimentador */}
            <div className="bg-[#08172E]/65 backdrop-blur-md border border-white/15 rounded-2xl p-4 flex items-center justify-between">
              <div>
                <span className="text-[11px] uppercase tracking-wider text-sky-200/75 block">
                  Alimentador
                </span>
                <span className="text-xl sm:text-2xl font-bold text-sky-300 mt-0.5 block">
                  {feedNowCommand
                    ? 'Alimentando...'
                    : nextSchedule
                    ? `Próx: ${nextSchedule.time}`
                    : 'Programado'}
                </span>
                <span className="text-xs text-emerald-300">
                  {nextSchedule ? nextSchedule.portion : feedNowPortion}
                </span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-[#1A539B]/60 border border-sky-300/25 flex items-center justify-center text-sky-200">
                <Utensils className="w-5 h-5" />
              </div>
            </div>
          </div>
        </section>
        )}

        {/* ===================================================================
            ABA 1: PAINEL PRINCIPAL
           =================================================================== */}
        {!exclusiveSetupMode && activeTab === 'dashboard' && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
              {/* COLUNA ESQUERDA (6 cols): NÍVEL DA ÁGUA */}
              <div className="lg:col-span-6 bg-[#0B1D35]/90 backdrop-blur-xl rounded-3xl border border-[#1A539B]/50 p-6 flex flex-col justify-between shadow-xl">
                <div>
                  <div className="flex items-start justify-between gap-4 mb-5">
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-2xl bg-[#1A539B] border border-sky-300/30 flex items-center justify-center text-white shadow-inner">
                        <Waves className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-white">
                          Nível da Água
                        </h3>
                        <p className="text-xs text-sky-200/70">
                          Capacidade útil: {maxVolumeLiters} Litros ({TANK_LENGTH_CM} × {TANK_WIDTH_CM} × {TANK_HEIGHT_CM} cm)
                        </p>
                      </div>
                    </div>

                    <span
                      className={`px-3 py-1 rounded-full text-xs font-semibold border ${waterStatus.bg} ${waterStatus.color}`}
                    >
                      {waterStatus.label}
                    </span>
                  </div>

                  {/* Visualização Gráfica do Aquário */}
                  <div className="relative h-64 rounded-2xl bg-gradient-to-b from-[#061121] to-[#091930] border-2 border-[#1A539B]/60 overflow-hidden shadow-inner mb-5">
                    {/* Régua lateral em percentual */}
                    <div className="absolute right-3 inset-y-4 z-20 flex flex-col justify-between text-[10px] font-mono-code text-sky-200/60 pointer-events-none">
                      <span>100%</span>
                      <span>75%</span>
                      <span>50%</span>
                      <span>25%</span>
                      <span>0%</span>
                    </div>

                    {/* Água animada */}
                    <div
                      className="absolute bottom-0 inset-x-0 transition-all duration-700 ease-out"
                      style={{ height: `${waterLevelPct !== null ? waterLevelPct : 0}%` }}
                    >
                      <div className="absolute -top-3 left-0 w-[200%] h-6 bg-[#1A539B]/80 rounded-[40%] animate-wave-slow"></div>
                      <div className="absolute -top-2 left-0 w-[200%] h-5 bg-sky-400/35 rounded-[45%] animate-wave-fast"></div>
                      <div className="w-full h-full bg-gradient-to-b from-[#1A539B]/85 via-[#154582]/90 to-[#0D2C56] relative overflow-hidden" />
                    </div>

                    {/* Indicador Central */}
                    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center pointer-events-none drop-shadow-md">
                      <span className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight">
                        {waterLevelPct !== null ? `${waterLevelPct}%` : '--'}
                      </span>
                      {waterVolumeLiters !== null && (
                        <span className="text-xs font-medium text-sky-100 bg-[#06101E]/65 px-3 py-0.5 rounded-full mt-1 border border-white/15">
                          Volume: {waterVolumeLiters} L
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Métricas do Aquário */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="bg-[#06101E]/70 border border-[#1A539B]/40 rounded-xl p-3 text-center">
                    <span className="text-[11px] text-sky-200/70 block">Nível Atual</span>
                    <span className="text-base font-bold text-sky-300 font-mono-code">
                      {waterLevelPct !== null ? `${waterLevelPct}%` : '--'}
                    </span>
                  </div>
                  <div className="bg-[#06101E]/70 border border-[#1A539B]/40 rounded-xl p-3 text-center">
                    <span className="text-[11px] text-sky-200/70 block">Volume Atual</span>
                    <span className="text-base font-bold text-white font-mono-code">
                      {waterVolumeLiters !== null ? `${waterVolumeLiters} / ${maxVolumeLiters} L` : `-- / ${maxVolumeLiters} L`}
                    </span>
                  </div>
                </div>
              </div>

              {/* COLUNA DIREITA (6 cols): DISPLAY LCD + TEMPERATURA */}
              <div className="lg:col-span-6 flex flex-col gap-6">
                {/* CARD: DISPLAY LCD */}
                <div className="bg-[#0B1D35]/90 backdrop-blur-xl rounded-3xl border border-[#1A539B]/50 p-6 shadow-xl">
                  <div className="flex items-center justify-between gap-4 mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-2xl bg-[#1A539B] border border-sky-300/30 flex items-center justify-center text-white">
                        <Monitor className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-white">Display LCD</h3>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setDraftConfig(config);
                        setWizardStep(3);
                        setActiveTab('setup');
                      }}
                      className="text-xs text-sky-300 hover:text-white flex items-center gap-1"
                    >
                      Personalizar visor <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Moldura do Display LCD */}
                  <div className="rounded-2xl bg-[#050D1A] border-2 border-[#1A539B]/70 p-4 shadow-inner">
                    <div className="rounded-xl bg-gradient-to-b from-[#0E3B2E] to-[#092920] border-2 border-emerald-400/40 px-5 py-4 shadow-[inset_0_0_24px_rgba(16,185,129,0.25)]">
                      <div className="font-mono-code text-xl sm:text-2xl font-bold tracking-[0.18em] text-emerald-200 drop-shadow-[0_0_8px_rgba(110,231,183,0.6)] whitespace-pre overflow-x-auto">
                        {lcdLine0}
                      </div>
                      <div className="font-mono-code text-xl sm:text-2xl font-bold tracking-[0.18em] text-emerald-200 drop-shadow-[0_0_8px_rgba(110,231,183,0.6)] whitespace-pre mt-1.5 overflow-x-auto">
                        {lcdLine1}
                      </div>
                    </div>
                  </div>
                </div>

                {/* CARD: TEMPERATURA */}
                <div className="bg-[#0B1D35]/90 backdrop-blur-xl rounded-3xl border border-[#1A539B]/50 p-6 shadow-xl flex-1 flex flex-col justify-between">
                  <div>
                    <div className="flex items-start justify-between gap-4 mb-5">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-2xl bg-[#1A539B] border border-sky-300/30 flex items-center justify-center text-white">
                          <Thermometer className="w-5 h-5" />
                        </div>
                        <div>
                          <h3 className="text-base font-bold text-white">
                            Temperatura da Água
                          </h3>
                          <p className="text-xs text-sky-200/70">
                            Monitoramento térmico em tempo real
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
                    <div className="bg-[#06101E]/80 border border-[#1A539B]/40 rounded-2xl p-5 flex items-center justify-between">
                      <div>
                        <span className="text-xs text-sky-200/70 block">
                          Temperatura Atual
                        </span>
                        <span className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight mt-1 block font-mono-code">
                          {temperatureC !== null ? `${Number(temperatureC).toFixed(1)} °C` : '--'}
                        </span>
                      </div>
                      <div className="text-right text-xs text-sky-200/70 space-y-1">
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
                      Histórico de Leituras
                    </h3>
                    <p className="text-xs text-sky-200/70">
                      Evolução recente do nível e temperatura da água
                    </p>
                  </div>
                </div>

                {history.length === 0 ? (
                  <div className="h-48 flex items-center justify-center rounded-2xl bg-[#06101E]/60 border border-[#1A539B]/30 text-xs text-sky-200/60">
                    Nenhum registro de histórico disponível ainda.
                  </div>
                ) : (
                  <>
                    <div className="h-48 flex items-end justify-between gap-3 pt-6 px-2 border-b border-[#1A539B]/40">
                      {history.map((point, idx) => {
                        const isLast = idx === history.length - 1;
                        return (
                          <div key={idx} className="flex-1 flex flex-col items-center gap-2">
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
                          {point.temp !== null && (
                            <div className="text-[10px] text-emerald-300/80">{point.temp}°C</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Últimas Leituras (5 cols) */}
              <div className="lg:col-span-5 bg-[#0B1D35]/90 backdrop-blur-xl rounded-3xl border border-[#1A539B]/50 p-6 shadow-xl flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-base font-bold text-white flex items-center gap-2">
                        <Activity className="w-4 h-4 text-sky-400" />
                        Últimas Leituras
                      </h3>
                      <p className="text-xs text-sky-200/70">Eventos recentes do aquário</p>
                    </div>
                    <button
                      onClick={() => setActiveTab('history')}
                      className="text-xs text-sky-300 hover:text-white flex items-center gap-1"
                    >
                      Ver todos <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {logs.length === 0 ? (
                    <div className="h-44 flex items-center justify-center rounded-2xl bg-[#06101E]/60 border border-[#1A539B]/30 text-xs text-sky-200/60 text-center px-4">
                      Nenhuma leitura registrada ainda.
                    </div>
                  ) : (
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
                            <div className="flex items-center justify-end mt-1 text-[10px] text-sky-200/60">
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
          </>
        )}

        {/* ===================================================================
            ABA DE CONFIGURAÇÕES (LIMPA E ORGANIZADA)
           =================================================================== */}
        {activeTab === 'setup' && (
          <div className="bg-[#0B1D35]/95 backdrop-blur-xl rounded-3xl border border-[#1A539B]/60 shadow-2xl overflow-hidden">
            {/* Cabeçalho Limpo + Abas Horizontais */}
            <div className="bg-[#081528] border-b border-[#1A539B]/50 px-6 py-4 flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#1A539B] border border-sky-300/40 flex items-center justify-center text-white">
                    <Settings className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-base sm:text-lg font-bold text-white">
                      Configurações do Aquário
                    </h2>
                    <p className="text-xs text-sky-200/70">
                      Capacidade útil calculada: <strong className="text-emerald-300 font-mono-code">{maxVolumeLiters} L</strong> ({TANK_LENGTH_CM}×{TANK_WIDTH_CM}×{TANK_HEIGHT_CM} cm)
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-center">
                  <button
                    onClick={handleResetFactoryDefaults}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#06101E] hover:bg-rose-500/20 text-xs font-medium text-sky-200/80 hover:text-rose-200 border border-[#1A539B]/50 hover:border-rose-400/40 transition"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Restaurar Padrão
                  </button>
                  <button
                    onClick={handleSaveWizardConfig}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold shadow-lg shadow-emerald-500/20 transition"
                  >
                    <Save className="w-4 h-4" />
                    Salvar Configurações
                  </button>
                </div>
              </div>

              {/* Sub-abas limpas de Configuração */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {wizardSteps.map((item) => {
                  const Icon = item.icon;
                  const active = wizardStep === item.step;
                  return (
                    <button
                      key={item.step}
                      type="button"
                      onClick={() => setWizardStep(item.step)}
                      className={`p-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition ${
                        active
                          ? 'bg-[#1A539B] border-sky-300/50 text-white shadow-md'
                          : 'bg-[#06101E]/70 border-[#1A539B]/35 text-sky-200/75 hover:bg-[#0F2747]/70 hover:text-white'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="truncate">{item.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {saveSuccess && (
              <div className="bg-emerald-500/20 border-b border-emerald-400/40 px-6 py-2.5 flex items-center justify-center gap-2 text-xs font-semibold text-emerald-200">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Configurações salvas com sucesso!</span>
              </div>
            )}

            <div className="p-6 sm:p-8 space-y-6">
              {/* ABA 1: ACESSO & DIMENSÕES DO AQUÁRIO */}
              {wizardStep === 1 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Acesso do ESP32 */}
                  <div className="bg-[#06101E]/85 border border-[#1A539B]/50 rounded-2xl p-5 space-y-4">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      Credenciais de Acesso do ESP32
                    </h3>

                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-semibold text-sky-200 mb-1">
                          Usuário do ESP32
                        </label>
                        <input
                          type="text"
                          readOnly
                          value={activeDeviceUsername}
                          className="w-full bg-[#0B1D35]/70 border border-[#1A539B]/50 rounded-xl px-3.5 py-2 text-sm font-mono-code text-emerald-300 cursor-not-allowed"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-sky-200 mb-1">
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
                            className="w-full bg-[#0B1D35] border border-[#1A539B]/60 rounded-xl pl-3.5 pr-10 py-2 text-sm font-mono-code text-white focus:outline-none focus:border-sky-400"
                          />
                          <button
                            type="button"
                            onClick={() => setShowWifiPassword((prev) => !prev)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-sky-300/70 hover:text-white"
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
                        Para trocar o Wi-Fi do ESP32, use o botão <strong>Portal ESP32</strong> no topo da página e conecte-se na rede <span className="font-mono-code text-sky-300">NETUNO-SETUP</span> (<span className="font-mono-code text-emerald-300">10.0.0.1</span>).
                      </div>
                    </div>
                  </div>

                  {/* Dimensões e Litragem */}
                  <div className="bg-[#06101E]/85 border border-[#1A539B]/50 rounded-2xl p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        <Droplets className="w-4 h-4 text-sky-400" />
                        Medidas do Aquário
                      </h3>
                      <span className="text-xs font-mono-code font-bold text-emerald-300 bg-emerald-500/15 border border-emerald-400/30 px-2.5 py-1 rounded-lg">
                        Volume Útil: {maxVolumeLiters} L
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="col-span-2">
                        <label className="block text-xs font-semibold text-sky-200 mb-1">
                          Nome do Aquário
                        </label>
                        <input
                          type="text"
                          maxLength={30}
                          value={draftConfig.aquariumName}
                          onChange={(e) =>
                            setDraftConfig({ ...draftConfig, aquariumName: e.target.value })
                          }
                          className="w-full bg-[#0B1D35] border border-[#1A539B]/60 rounded-xl px-3.5 py-2 text-sm text-white"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-sky-200 mb-1">
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
                          className="w-full bg-[#0B1D35] border border-[#1A539B]/60 rounded-xl px-3.5 py-2 text-sm font-mono-code text-white"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-sky-200 mb-1">
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
                          className="w-full bg-[#0B1D35] border border-[#1A539B]/60 rounded-xl px-3.5 py-2 text-sm font-mono-code text-white"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-sky-200 mb-1">
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
                          className="w-full bg-[#0B1D35] border border-[#1A539B]/60 rounded-xl px-3.5 py-2 text-sm font-mono-code text-white"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-sky-200 mb-1">
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
                          className="w-full bg-[#0B1D35] border border-[#1A539B]/60 rounded-xl px-3.5 py-2 text-sm font-mono-code text-white"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ABA 2: NÍVEIS DE ÁGUA & TEMPERATURA IDEAL */}
              {wizardStep === 2 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Limites de Nível */}
                  <div className="bg-[#06101E]/85 border border-[#1A539B]/50 rounded-2xl p-5 space-y-4">
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
                  <div className="bg-[#06101E]/85 border border-[#1A539B]/50 rounded-2xl p-5 space-y-4">
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
                            className={`p-2.5 rounded-xl border text-center transition ${
                              selected
                                ? 'bg-[#1A539B] border-sky-300 text-white'
                                : 'bg-[#0B1D35] border-[#1A539B]/40 text-sky-200 hover:bg-[#0F2747]'
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
                          className="w-full bg-[#0B1D35] border border-[#1A539B] rounded-xl px-3.5 py-2 text-sm font-bold font-mono-code text-white"
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
                          className="w-full bg-[#0B1D35] border border-[#1A539B] rounded-xl px-3.5 py-2 text-sm font-bold font-mono-code text-white"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ABA 3: DISPLAY LCD */}
              {wizardStep === 3 && (
                <div className="space-y-5">
                  <div className="rounded-2xl bg-[#050D1A] border-2 border-[#1A539B]/70 p-4 shadow-inner">
                    <div className="text-[11px] text-sky-300/80 mb-2 flex justify-between">
                      <span>Prévia do Display LCD (16x2)</span>
                      {draftConfig.lcdCarousel && (
                        <span className="text-emerald-300 font-semibold">Carrossel Ativo (4s)</span>
                      )}
                    </div>
                    <div className="rounded-xl bg-gradient-to-b from-[#0E3B2E] to-[#092920] border-2 border-emerald-400/40 px-5 py-3.5">
                      <div className="font-mono-code text-xl sm:text-2xl font-bold tracking-[0.18em] text-emerald-200 whitespace-pre">
                        {lcdLine0}
                      </div>
                      <div className="font-mono-code text-xl sm:text-2xl font-bold tracking-[0.18em] text-emerald-200 whitespace-pre mt-1">
                        {lcdLine1}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-sky-200 mb-1">
                        Linha 1 (Superior)
                      </label>
                      <select
                        value={draftConfig.lcdLine1Mode}
                        onChange={(e) =>
                          setDraftConfig({ ...draftConfig, lcdLine1Mode: e.target.value })
                        }
                        className="w-full bg-[#06101E] border border-[#1A539B]/60 rounded-xl px-3.5 py-2.5 text-sm text-white"
                      >
                        <option value="water_pct">Nível da Água (%)</option>
                        <option value="volume_liters">Volume Atual (Litros)</option>
                        <option value="rtc_time">Horário do RTC</option>
                        <option value="custom_title">Texto Personalizado</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-sky-200 mb-1">
                        Linha 2 (Inferior)
                      </label>
                      <select
                        value={draftConfig.lcdLine2Mode}
                        onChange={(e) =>
                          setDraftConfig({ ...draftConfig, lcdLine2Mode: e.target.value })
                        }
                        className="w-full bg-[#06101E] border border-[#1A539B]/60 rounded-xl px-3.5 py-2.5 text-sm text-white"
                      >
                        <option value="temp_c">Temperatura (°C)</option>
                        <option value="rtc_time">Horário do RTC</option>
                        <option value="pump_status">Status da Bomba (Ligada / Desligada)</option>
                        <option value="next_feed">Próximo Horário de Comida</option>
                      </select>
                    </div>

                    {draftConfig.lcdLine1Mode === 'custom_title' && (
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-semibold text-sky-200 mb-1">
                          Texto Personalizado (Máx. 16 caracteres)
                        </label>
                        <input
                          type="text"
                          maxLength={16}
                          value={draftConfig.lcdCustomText}
                          onChange={(e) =>
                            setDraftConfig({ ...draftConfig, lcdCustomText: e.target.value })
                          }
                          className="w-full bg-[#06101E] border border-[#1A539B]/60 rounded-xl px-3.5 py-2 text-sm font-mono-code uppercase text-white"
                          placeholder="NETUNO AQUARIO"
                        />
                      </div>
                    )}

                    <div className="sm:col-span-2 bg-[#06101E]/85 border border-[#1A539B]/40 rounded-2xl p-4 flex items-center justify-between">
                      <div>
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
                        className={`w-12 h-6 rounded-full p-1 transition ${
                          draftConfig.lcdCarousel ? 'bg-emerald-500' : 'bg-slate-700'
                        }`}
                      >
                        <div
                          className={`w-4 h-4 rounded-full bg-white transition-transform ${
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
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="space-y-6">
                    {/* Relógio RTC */}
                    <div className="bg-[#06101E]/85 border border-[#1A539B]/50 rounded-2xl p-5 space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-bold text-white flex items-center gap-2">
                          <Clock className="w-4 h-4 text-sky-400" />
                          Relógio do Módulo RTC
                        </h4>
                        <span className="font-mono-code text-xs font-bold text-emerald-300">
                          {rtcTimeFormatted}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5">
                        <input
                          type="date"
                          value={rtcEditDate}
                          onChange={(e) => setRtcEditDate(e.target.value)}
                          className="bg-[#0B1D35] border border-[#1A539B] rounded-xl px-3 py-2 text-xs font-mono-code text-white"
                        />
                        <input
                          type="time"
                          step="1"
                          value={rtcEditTime}
                          onChange={(e) => setRtcEditTime(e.target.value)}
                          className="bg-[#0B1D35] border border-[#1A539B] rounded-xl px-3 py-2 text-xs font-mono-code text-white"
                        />
                      </div>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleApplyRtcDateTime(null)}
                          className="flex-1 py-2 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-extrabold transition"
                        >
                          Gravar no RTC
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApplyRtcDateTime(new Date().toISOString())}
                          className="py-2 px-3 rounded-xl bg-[#1A539B] hover:bg-[#2364B8] text-white text-xs font-bold border border-sky-300/30 transition"
                        >
                          Sincronizar Hora Atual
                        </button>
                      </div>

                      {rtcSaveNotice && (
                        <div className="text-xs text-emerald-300 flex items-center gap-1.5 font-semibold">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Horário atualizado no RTC!
                        </div>
                      )}
                    </div>

                    {/* Bomba de Oxigênio */}
                    <div className="bg-[#06101E]/85 border border-[#1A539B]/50 rounded-2xl p-5 space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-bold text-white flex items-center gap-2">
                          <Wind className="w-4 h-4 text-sky-400" />
                          Bomba ({pumpRelayOn ? 'Ligada' : 'Desligada'})
                        </h4>
                        <button
                          type="button"
                          onClick={handleTogglePump}
                          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                            pumpRelayOn
                              ? 'bg-emerald-500 text-slate-950'
                              : 'bg-[#1A539B] text-white border border-sky-300/30'
                          }`}
                        >
                          <Power className="w-3.5 h-3.5" />
                          {pumpRelayOn ? 'Desligar Bomba' : 'Ligar Bomba'}
                        </button>
                      </div>

                      <div className="grid grid-cols-3 gap-2.5 pt-1">
                        <div>
                          <label className="block text-[11px] text-sky-200/80 mb-1">Modo</label>
                          <select
                            value={draftConfig.pumpMode}
                            onChange={(e) =>
                              setDraftConfig({ ...draftConfig, pumpMode: e.target.value })
                            }
                            className="w-full bg-[#0B1D35] border border-[#1A539B] rounded-xl px-2.5 py-2 text-xs text-white"
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
                            className="w-full bg-[#0B1D35] border border-[#1A539B] rounded-xl px-2.5 py-2 text-xs font-mono-code text-white"
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
                            className="w-full bg-[#0B1D35] border border-[#1A539B] rounded-xl px-2.5 py-2 text-xs font-mono-code text-white"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Alimentador Automático */}
                  <div className="bg-[#06101E]/85 border border-[#1A539B]/50 rounded-2xl p-5 space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-sm font-bold text-white flex items-center gap-2">
                        <Utensils className="w-4 h-4 text-sky-400" />
                        Alimentador ({schedules.length}/8 horários)
                      </h4>
                      <button
                        type="button"
                        onClick={() => handleTriggerFeedNow(draftConfig.defaultPortion)}
                        disabled={feedNowCommand}
                        className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                          feedNowCommand
                            ? 'bg-amber-400 text-slate-950 animate-pulse'
                            : 'bg-gradient-to-r from-[#1A539B] to-sky-500 text-white'
                        }`}
                      >
                        <Utensils className="w-3.5 h-3.5" />
                        {feedNowCommand ? 'Alimentando...' : 'Alimentar Agora'}
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      {['Leve (3g)', 'Padrão (5g)', 'Generosa (8g)'].map((portion) => (
                        <button
                          key={portion}
                          type="button"
                          onClick={() =>
                            setDraftConfig({ ...draftConfig, defaultPortion: portion })
                          }
                          className={`py-2 px-2.5 rounded-xl text-xs font-semibold border transition ${
                            draftConfig.defaultPortion === portion
                              ? 'bg-[#1A539B] border-sky-400 text-white'
                              : 'bg-[#0B1D35] border-[#1A539B]/40 text-sky-200/70'
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
                          className="bg-[#0B1D35] border border-[#1A539B]/50 rounded-xl p-2.5 flex items-center justify-between"
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
                              className={`w-8 h-4 rounded-full p-0.5 transition ${
                                item.enabled ? 'bg-emerald-500' : 'bg-slate-700'
                              }`}
                            >
                              <div
                                className={`w-3 h-3 rounded-full bg-white transition-transform ${
                                  item.enabled ? 'translate-x-4' : 'translate-x-0'
                                }`}
                              />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteSchedule(item.id)}
                              className="p-1 text-rose-400 hover:text-rose-300"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {schedules.length < 8 && (
                      <form onSubmit={handleAddSchedule} className="flex gap-2 pt-1">
                        <input
                          type="time"
                          value={newScheduleTime}
                          onChange={(e) => setNewScheduleTime(e.target.value)}
                          className="bg-[#0B1D35] border border-[#1A539B] rounded-xl px-2.5 py-2 text-xs font-mono-code text-white"
                        />
                        <select
                          value={newSchedulePortion}
                          onChange={(e) => setNewSchedulePortion(e.target.value)}
                          className="bg-[#0B1D35] border border-[#1A539B] rounded-xl px-2.5 py-2 text-xs text-white flex-1"
                        >
                          <option value="Leve (3g)">Leve (3g)</option>
                          <option value="Padrão (5g)">Padrão (5g)</option>
                          <option value="Generosa (8g)">Generosa (8g)</option>
                        </select>
                        <button
                          type="submit"
                          className="bg-[#1A539B] hover:bg-[#2364B8] text-white text-xs font-bold px-3.5 py-2 rounded-xl flex items-center gap-1"
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
        {!exclusiveSetupMode && activeTab === 'history' && (
          <div className="bg-[#0B1D35]/90 backdrop-blur-xl rounded-3xl border border-[#1A539B]/50 p-6 sm:p-8 shadow-xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#1A539B]/40 pb-5">
              <div>
                <h3 className="text-xl font-bold text-white flex items-center gap-2.5">
                  <Activity className="w-5 h-5 text-sky-400" />
                  Histórico de Eventos
                </h3>
                <p className="text-xs sm:text-sm text-sky-200/70 mt-1">
                  Registro completo das leituras do aquário.
                </p>
              </div>
              <button
                onClick={fetchSupabaseData}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#1A539B] hover:bg-[#2364B8] text-xs font-semibold text-white border border-sky-300/30 transition"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Atualizar Agora
              </button>
            </div>

            {logs.length === 0 ? (
              <div className="py-12 text-center text-sm text-sky-200/60 bg-[#06101E]/60 rounded-2xl border border-[#1A539B]/30">
                Nenhum registro encontrado no histórico.
              </div>
            ) : (
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
                      </div>
                    </div>
                    <span className="text-xs font-mono-code text-sky-300 bg-[#0B1D35] px-3 py-1.5 rounded-lg border border-[#1A539B]/40 self-start sm:self-center">
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
