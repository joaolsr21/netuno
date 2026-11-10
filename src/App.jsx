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
        return `Bomba: ${pumpRelayOn ? 'Aberta  ' : 'Fechada '}`.slice(0, 16).padEnd(16, ' ');
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

  const handleOpenExclusiveSetupCommand = async (startStep = 1) => {
    setDraftConfig({
      ...config,
      deviceUsername: activeDeviceUsername || config.deviceUsername || '',
      devicePassword: authDevice?.password || config.devicePassword || '',
    });
    setWizardStep(startStep);
    setExclusiveSetupMode(true);
    setActiveTab('setup');
    if (isSupabaseConfigured && supabase && activeDeviceUsername) {
      await supabase
        .from('aquarium_status')
        .update({ wifi_setup_command: true })
        .eq('device_username', activeDeviceUsername)
        .catch(() => {});
    }
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
      title: 'Rede Wi-Fi',
      subtitle: 'Conexão sem fio e portal inicial',
      icon: Wifi,
    },
    {
      step: 2,
      title: 'Dimensões & Litragem',
      subtitle: 'Tamanho do aquário e cálculo de volume',
      icon: Droplets,
    },
    {
      step: 3,
      title: 'Níveis de Água',
      subtitle: 'Limites de alerta crítico, baixo e cheio',
      icon: Waves,
    },
    {
      step: 4,
      title: 'Temperatura Ideal',
      subtitle: 'Faixa térmica ideal para os peixes',
      icon: Thermometer,
    },
    {
      step: 5,
      title: 'Display LCD',
      subtitle: 'Personalização do que aparece no visor',
      icon: Monitor,
    },
    {
      step: 6,
      title: 'Relógio RTC, Bomba & Comida',
      subtitle: 'Horário do RTC, oxigenação e alimentador',
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
                { id: 'setup', label: 'Configuração do Sistema', icon: Settings },
                { id: 'history', label: 'Histórico', icon: TrendingUp },
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

          {/* Relógio em Tempo Real (RTC) fora de card + Botão de Comando para Abrir Tela Exclusiva de Configuração */}
          <div className="flex items-center gap-3 sm:gap-4">
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

            {!exclusiveSetupMode ? (
              <button
                onClick={() => handleOpenExclusiveSetupCommand(1)}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-gradient-to-r from-[#1A539B] to-sky-500 hover:from-[#2161B2] hover:to-sky-400 border border-sky-300/40 text-xs font-bold text-white shadow-md shadow-[#1A539B]/40 transition"
                title="Envia comando para abrir apenas a tela de configuração inicial e Wi-Fi"
              >
                <Wifi className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Configurar Wi-Fi & Sistema</span>
                <span className="sm:hidden">Setup</span>
              </button>
            ) : (
              config.setupCompleted && (
                <button
                  onClick={() => {
                    setExclusiveSetupMode(false);
                    setActiveTab('dashboard');
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#0F2747] hover:bg-[#1A539B] border border-sky-300/30 text-xs font-semibold text-sky-200 hover:text-white transition"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Voltar ao Painel</span>
                </button>
              )
            )}

            <button
              onClick={handleDeviceLogout}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#0B1D35] hover:bg-rose-500/20 border border-[#1A539B]/60 hover:border-rose-400/50 text-xs font-semibold text-sky-200 hover:text-rose-200 transition"
              title="Sair ou trocar de ESP32"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Trocar ESP32</span>
            </button>
          </div>
        </div>

        {/* Navegação Mobile */}
        {!exclusiveSetupMode && (
          <div className="flex md:hidden border-t border-[#1A539B]/30 bg-[#081528] px-2 py-1.5 justify-around">
            {[
              { id: 'dashboard', label: 'Painel', icon: Gauge },
              { id: 'setup', label: 'Configuração', icon: Settings },
              { id: 'history', label: 'Histórico', icon: TrendingUp },
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
                  {pumpRelayOn ? 'Aberta' : 'Fechada'}
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
                        setWizardStep(5);
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
            ABA 2: ASSISTENTE DE CONFIGURAÇÃO INICIAL (ESTILO ROTEADOR)
           =================================================================== */}
        {activeTab === 'setup' && (
          <div className="bg-[#0B1D35]/95 backdrop-blur-xl rounded-3xl border border-[#1A539B]/60 shadow-2xl overflow-hidden">
            {/* Barra de Topo Estilo Painel Admin de Roteador */}
            <div className="bg-gradient-to-r from-[#081528] via-[#0F2747] to-[#081528] border-b border-[#1A539B]/50 px-6 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-2xl bg-[#1A539B] border border-sky-300/40 flex items-center justify-center text-white shadow-lg">
                  <Settings className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono-code uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-400/30">
                      Setup Wizard • Netuno OS
                    </span>
                  </div>
                  <h2 className="text-lg sm:text-xl font-bold text-white mt-1">
                    Assistente de Configuração Inicial do Aquário
                  </h2>
                  <p className="text-xs text-sky-200/70">
                    Defina os parâmetros físicos, limites de alerta, visor LCD, oxigenação e alimentação.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2.5 self-start sm:self-center">
                <button
                  onClick={handleResetFactoryDefaults}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#06101E] hover:bg-rose-500/20 text-xs font-medium text-sky-200/80 hover:text-rose-200 border border-[#1A539B]/50 hover:border-rose-400/40 transition"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Padrão de Fábrica
                </button>
                <button
                  onClick={handleSaveWizardConfig}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold shadow-lg shadow-emerald-500/20 transition"
                >
                  <Save className="w-4 h-4" />
                  Salvar e Aplicar
                </button>
              </div>
            </div>

            {saveSuccess && (
              <div className="bg-emerald-500/20 border-b border-emerald-400/40 px-6 py-3 flex items-center justify-center gap-2 text-xs font-semibold text-emerald-200">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Configurações salvas e aplicadas com sucesso ao sistema Netuno!</span>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12">
              {/* Menu Lateral de Etapas (Stepper de Roteador) */}
              <div className="lg:col-span-4 bg-[#081528]/90 border-b lg:border-b-0 lg:border-r border-[#1A539B]/40 p-5 space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-sky-300/70 px-2 mb-3">
                  Etapas de Configuração
                </div>
                {wizardSteps.map((item) => {
                  const Icon = item.icon;
                  const active = wizardStep === item.step;
                  const completed = wizardStep > item.step;
                  return (
                    <button
                      key={item.step}
                      onClick={() => setWizardStep(item.step)}
                      className={`w-full text-left p-3.5 rounded-2xl border transition-all flex items-start gap-3.5 ${
                        active
                          ? 'bg-[#1A539B] border-sky-300/40 text-white shadow-lg shadow-[#1A539B]/30'
                          : 'bg-[#06101E]/60 border-[#1A539B]/30 text-sky-100/80 hover:bg-[#0F2747]/60'
                      }`}
                    >
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 font-bold text-xs ${
                          active
                            ? 'bg-white text-[#1A539B]'
                            : completed
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/40'
                            : 'bg-[#0B1D35] text-sky-300 border border-[#1A539B]/50'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] uppercase tracking-wider opacity-75">
                            Passo {item.step} de 6
                          </span>
                          {completed && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" />}
                        </div>
                        <div className="text-sm font-bold truncate mt-0.5">{item.title}</div>
                        <div className="text-[11px] opacity-75 truncate">{item.subtitle}</div>
                      </div>
                    </button>
                  );
                })}

                {/* Resumo Instantâneo do Cálculo no Menu Lateral */}
                <div className="mt-6 pt-4 border-t border-[#1A539B]/30 px-2 space-y-2 text-xs">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-sky-300/80">
                    Resumo da Configuração
                  </div>
                  <div className="bg-[#06101E] border border-[#1A539B]/40 rounded-2xl p-3.5 space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-sky-200/70">Rede Wi-Fi:</span>
                      <span className="font-mono-code text-sky-300 font-semibold truncate max-w-[130px]">
                        {draftConfig.wifiSsid || 'Não definida'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sky-200/70">Medidas:</span>
                      <span className="font-mono-code text-white font-semibold">
                        {TANK_LENGTH_CM}×{TANK_WIDTH_CM}×{TANK_HEIGHT_CM} cm
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sky-200/70">Litragem Útil:</span>
                      <span className="font-mono-code text-emerald-300 font-bold">
                        {maxVolumeLiters} Litros
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sky-200/70">Temp. Ideal:</span>
                      <span className="font-mono-code text-sky-300">
                        {draftConfig.tempMinC}°C a {draftConfig.tempMaxC}°C
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sky-200/70">Alerta Crítico:</span>
                      <span className="font-mono-code text-rose-300">
                        &lt; {draftConfig.criticalLevelPct}%
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Conteúdo da Etapa Selecionada */}
              <div className="lg:col-span-8 p-6 sm:p-8 flex flex-col justify-between space-y-6">
                {/* PASSO 1: PAINEL DE CONFIGURAÇÃO WI-FI E PORTAL INICIAL */}
                {wizardStep === 1 && (
                  <div className="space-y-6">
                    <div>
                      <span className="text-xs font-semibold uppercase tracking-wider text-sky-400">
                        Passo 1 de 6 • Conectividade Sem Fio
                      </span>
                      <h3 className="text-xl font-bold text-white mt-1">
                        Painel de Configuração Wi-Fi e Primeiro Uso
                      </h3>
                      <p className="text-xs sm:text-sm text-sky-200/75 mt-1">
                        Selecione a rede Wi-Fi 2.4GHz na qual o aquário irá se conectar ou configure o ponto de acesso temporário quando o sistema ligar pela primeira vez.
                      </p>
                    </div>

                    {/* Card do Modo Primeiro Uso / Portal de Configuração */}
                    <div className="bg-gradient-to-r from-[#06101E] to-[#0F2747]/80 border border-sky-400/35 rounded-2xl p-4 sm:p-5 space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 rounded-xl bg-sky-500/20 border border-sky-400/40 flex items-center justify-center shrink-0 mt-0.5">
                            <Radio className="w-5 h-5 text-sky-300" />
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-white">
                              Abertura Automática no Primeiro Uso ou via Comando
                            </h4>
                            <p className="text-xs text-sky-200/75 mt-0.5">
                              Quando ligado pela primeira vez sem Wi-Fi ou sem usuário cadastrado, o ESP32 cria a rede <span className="font-mono-code text-sky-300">{draftConfig.wifiApName}</span> no endereço <span className="font-mono-code text-emerald-300">{draftConfig.wifiPortalIp}</span> para cadastrar a rede Wi-Fi e o <strong>Usuário e Senha</strong> deste ESP32.
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            setDraftConfig({
                              ...draftConfig,
                              autoPortalOnFirstBoot: !draftConfig.autoPortalOnFirstBoot,
                            })
                          }
                          className={`px-3.5 py-2 rounded-xl text-xs font-bold border shrink-0 transition ${
                            draftConfig.autoPortalOnFirstBoot
                              ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300'
                              : 'bg-slate-800 border-slate-700 text-slate-400'
                          }`}
                        >
                          {draftConfig.autoPortalOnFirstBoot
                            ? 'Portal Automático: Ativo'
                            : 'Portal Automático: Inativo'}
                        </button>
                      </div>
                    </div>

                    {/* Credenciais de Acesso Exclusivo deste ESP32 */}
                    <div className="bg-[#06101E]/85 border border-emerald-400/40 rounded-2xl p-4 sm:p-5 space-y-4">
                      <div>
                        <h4 className="text-sm font-bold text-white flex items-center gap-2">
                          <ShieldCheck className="w-4 h-4 text-emerald-400" />
                          Usuário e Senha de Acesso deste ESP32
                        </h4>
                        <p className="text-[11px] text-sky-200/70">
                          Credenciais cadastradas na rede inicial do ESP32 (10.0.0.1) usadas para acessar exclusivamente este aquário no site.
                        </p>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-sky-200 mb-1.5">
                            Usuário Vinculado ao ESP32
                          </label>
                          <input
                            type="text"
                            readOnly
                            value={activeDeviceUsername}
                            className="w-full bg-[#0B1D35]/70 border border-[#1A539B]/50 rounded-xl px-4 py-2.5 text-sm font-mono-code text-emerald-300 cursor-not-allowed"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-sky-200 mb-1.5">
                            Senha de Acesso ao ESP32 no Site
                          </label>
                          <input
                            type={showWifiPassword ? 'text' : 'password'}
                            maxLength={32}
                            value={draftConfig.devicePassword ?? authDevice?.password ?? ''}
                            onChange={(e) =>
                              setDraftConfig({ ...draftConfig, devicePassword: e.target.value })
                            }
                            placeholder="Senha deste ESP32"
                            className="w-full bg-[#0B1D35] border border-[#1A539B]/60 rounded-xl px-4 py-2.5 text-sm font-mono-code text-white focus:outline-none focus:border-sky-400"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Lista de Redes Wi-Fi Encontradas */}
                    <div className="bg-[#06101E]/85 border border-[#1A539B]/50 rounded-2xl p-4 sm:p-5 space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-sm font-bold text-white flex items-center gap-2">
                            <Wifi className="w-4 h-4 text-sky-400" />
                            Redes Wi-Fi 2.4GHz Disponíveis
                          </h4>
                          <p className="text-[11px] text-sky-200/70">
                            Clique em uma rede da lista para preencher automaticamente ou digite o nome abaixo
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={handleScanWifiNetworks}
                          disabled={scanningWifi}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#0B1D35] hover:bg-[#1A539B] text-sky-200 hover:text-white border border-[#1A539B]/70 text-xs font-semibold transition"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${scanningWifi ? 'animate-spin' : ''}`} />
                          {scanningWifi ? 'Buscando...' : 'Buscar Redes'}
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {availableNetworks.map((net) => {
                          const isSelected = draftConfig.wifiSsid === net.ssid;
                          const signalStrength =
                            net.rssi > -50 ? 'Forte' : net.rssi > -68 ? 'Bom' : 'Médio';
                          return (
                            <button
                              key={net.ssid}
                              type="button"
                              onClick={() =>
                                setDraftConfig({ ...draftConfig, wifiSsid: net.ssid })
                              }
                              className={`p-3 rounded-xl border text-left flex items-center justify-between transition ${
                                isSelected
                                  ? 'bg-[#1A539B]/70 border-sky-300 text-white shadow-md'
                                  : 'bg-[#0B1D35]/70 border-[#1A539B]/40 text-sky-100 hover:bg-[#0F2747]'
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <Wifi className="w-4 h-4 text-sky-300 shrink-0" />
                                <div className="truncate">
                                  <div className="text-xs font-bold truncate">{net.ssid}</div>
                                  <div className="text-[10px] text-sky-200/70">{net.security}</div>
                                </div>
                              </div>
                              <span className="text-[11px] font-mono-code px-2 py-0.5 rounded-md bg-[#06101E]/70 text-emerald-300 border border-emerald-400/20">
                                {signalStrength}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Credenciais da Rede Wi-Fi e Adição na Lista Multi-WiFi */}
                    <div className="bg-[#06101E]/85 border border-[#1A539B]/50 rounded-2xl p-4 sm:p-5 space-y-4">
                      <div>
                        <h4 className="text-sm font-bold text-white">
                          Adicionar ou Atualizar Rede Wi-Fi
                        </h4>
                        <p className="text-[11px] text-sky-200/70">
                          Você pode salvar até 5 redes Wi-Fi diferentes. Se uma cair, o sistema conecta automaticamente na próxima rede disponível com melhor sinal.
                        </p>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-sky-200 mb-1.5">
                            Nome da Rede Wi-Fi (SSID)
                          </label>
                          <input
                            type="text"
                            maxLength={32}
                            value={draftConfig.wifiSsid}
                            onChange={(e) =>
                              setDraftConfig({ ...draftConfig, wifiSsid: e.target.value })
                            }
                            className="w-full bg-[#0B1D35] border border-[#1A539B]/60 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-sky-400"
                            placeholder="Digite o nome do Wi-Fi"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-sky-200 mb-1.5">
                            Senha do Wi-Fi
                          </label>
                          <div className="relative">
                            <input
                              type={showWifiPassword ? 'text' : 'password'}
                              maxLength={64}
                              value={draftConfig.wifiPassword}
                              onChange={(e) =>
                                setDraftConfig({ ...draftConfig, wifiPassword: e.target.value })
                              }
                              className="w-full bg-[#0B1D35] border border-[#1A539B]/60 rounded-xl pl-4 pr-10 py-2.5 text-sm font-mono-code text-white focus:outline-none focus:border-sky-400"
                              placeholder="Digite a senha da rede"
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

                        <div className="sm:col-span-2 flex flex-wrap items-center gap-2.5">
                          <button
                            type="button"
                            onClick={() => {
                              const clean = (draftConfig.wifiSsid || '').trim();
                              if (!clean) return;
                              const currentList = Array.isArray(draftConfig.savedWifiNetworks)
                                ? draftConfig.savedWifiNetworks
                                : [];
                              const existingIdx = currentList.findIndex(
                                (item) => item.ssid.toLowerCase() === clean.toLowerCase()
                              );
                              let nextList;
                              if (existingIdx >= 0) {
                                nextList = currentList.map((item, idx) =>
                                  idx === existingIdx
                                    ? { ...item, ssid: clean, password: draftConfig.wifiPassword }
                                    : item
                                );
                              } else {
                                if (currentList.length >= 5) return;
                                nextList = [
                                  ...currentList,
                                  {
                                    id: Date.now(),
                                    ssid: clean,
                                    password: draftConfig.wifiPassword,
                                    priority:
                                      currentList.length === 0
                                        ? 'Principal (1ª opção)'
                                        : `Reserva Automática (${currentList.length + 1}ª opção)`,
                                  },
                                ];
                              }
                              setDraftConfig({
                                ...draftConfig,
                                savedWifiNetworks: nextList,
                              });
                            }}
                            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-extrabold transition"
                          >
                            <Plus className="w-4 h-4" />
                            Salvar na Lista de Redes ({(draftConfig.savedWifiNetworks || []).length}/5)
                          </button>

                          <button
                            type="button"
                            onClick={handleTestWifiConnection}
                            className={`py-2.5 px-4 rounded-xl text-xs font-bold flex items-center gap-2 border transition ${
                              wifiTestStatus === 'connecting'
                                ? 'bg-amber-400 text-slate-950 border-amber-300 animate-pulse'
                                : 'bg-[#1A539B] hover:bg-[#2364B8] text-white border-sky-300/40 shadow-md'
                            }`}
                          >
                            <Wifi className="w-4 h-4" />
                            {wifiTestStatus === 'connecting'
                              ? 'Testando Conexão...'
                              : `Testar "${draftConfig.wifiSsid || 'Wi-Fi'}"`}
                          </button>
                        </div>
                      </div>

                      {/* Lista de Redes Salvas na Memória (Multi-WiFi Failover) */}
                      <div className="pt-3 border-t border-[#1A539B]/40 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-sky-200">
                            Redes Wi-Fi Salvas para Troca Automática ({(draftConfig.savedWifiNetworks || []).length}/5)
                          </span>
                          <span className="text-[11px] text-emerald-300">
                            Troca automática caso uma rede caia
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          {(draftConfig.savedWifiNetworks || []).map((savedNet, index) => (
                            <div
                              key={savedNet.id || savedNet.ssid}
                              className="bg-[#0B1D35] border border-[#1A539B]/50 rounded-xl p-3 flex items-center justify-between gap-2"
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-400/30">
                                    #{index + 1}
                                  </span>
                                  <span className="text-xs font-bold text-white truncate">
                                    {savedNet.ssid}
                                  </span>
                                </div>
                                <span className="text-[10px] text-sky-200/70 block mt-1">
                                  {index === 0 ? 'Rede Principal Preferencial' : 'Rede Reserva (Failover)'}
                                </span>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDraftConfig({
                                      ...draftConfig,
                                      wifiSsid: savedNet.ssid,
                                      wifiPassword: savedNet.password || '',
                                    })
                                  }
                                  className="px-2.5 py-1 rounded-lg bg-[#06101E] hover:bg-[#1A539B] text-[11px] text-sky-300 hover:text-white border border-[#1A539B]/60 transition"
                                >
                                  Usar
                                </button>
                                {(draftConfig.savedWifiNetworks || []).length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const nextList = (draftConfig.savedWifiNetworks || []).filter(
                                        (item) => item.ssid !== savedNet.ssid
                                      );
                                      setDraftConfig({
                                        ...draftConfig,
                                        savedWifiNetworks: nextList,
                                        wifiSsid: nextList[0]?.ssid || draftConfig.wifiSsid,
                                      });
                                    }}
                                    className="p-1.5 text-rose-400 hover:text-rose-300"
                                    title="Remover rede salva"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* PASSO 2: DIMENSÕES DO AQUÁRIO E LITRAGEM */}
                {wizardStep === 2 && (
                  <div className="space-y-6">
                    <div>
                      <span className="text-xs font-semibold uppercase tracking-wider text-sky-400">
                        Passo 2 de 6 • Geometria e Capacidade
                      </span>
                      <h3 className="text-xl font-bold text-white mt-1">
                        Dimensões do Aquário e Cálculo de Litragem
                      </h3>
                      <p className="text-xs sm:text-sm text-sky-200/75 mt-1">
                        Informe as medidas reais do seu aquário em centímetros. O sistema calcula automaticamente o volume máximo e os litros atuais.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-semibold text-sky-200 mb-1.5">
                          Nome de Identificação do Aquário
                        </label>
                        <input
                          type="text"
                          maxLength={30}
                          value={draftConfig.aquariumName}
                          onChange={(e) =>
                            setDraftConfig({ ...draftConfig, aquariumName: e.target.value })
                          }
                          className="w-full bg-[#06101E] border border-[#1A539B]/60 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-sky-400"
                          placeholder="Ex: Aquário Principal da Sala"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-sky-200 mb-1.5">
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
                          className="w-full bg-[#06101E] border border-[#1A539B]/60 rounded-xl px-4 py-2.5 text-sm font-mono-code text-white focus:outline-none focus:border-sky-400"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-sky-200 mb-1.5">
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
                          className="w-full bg-[#06101E] border border-[#1A539B]/60 rounded-xl px-4 py-2.5 text-sm font-mono-code text-white focus:outline-none focus:border-sky-400"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-sky-200 mb-1.5">
                          Altura Total do Vidro (cm) — Limite: 150 cm
                        </label>
                        <input
                          type="number"
                          min={10}
                          max={150}
                          value={draftConfig.heightCm}
                          onChange={(e) =>
                            setDraftConfig({ ...draftConfig, heightCm: Number(e.target.value) })
                          }
                          className="w-full bg-[#06101E] border border-[#1A539B]/60 rounded-xl px-4 py-2.5 text-sm font-mono-code text-white focus:outline-none focus:border-sky-400"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-sky-200 mb-1.5">
                          Margem de Segurança no Topo (cm) — Mínimo: 2 cm
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
                          className="w-full bg-[#06101E] border border-[#1A539B]/60 rounded-xl px-4 py-2.5 text-sm font-mono-code text-white focus:outline-none focus:border-sky-400"
                        />
                        <span className="text-[11px] text-sky-300/70 mt-1 block">
                          Distância mínima entre a borda superior/sensor e o nível de 100% da água.
                        </span>
                      </div>
                    </div>

                    {/* Card de Resultado Automático da Litragem */}
                    <div className="bg-gradient-to-r from-[#06101E] to-[#0F2747]/80 border border-sky-400/30 rounded-2xl p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <span className="text-[11px] text-sky-200/70 block">Volume Total Bruto</span>
                        <span className="text-xl font-bold text-white font-mono-code">
                          {((TANK_LENGTH_CM * TANK_WIDTH_CM * TANK_HEIGHT_CM) / 1000).toFixed(2)} L
                        </span>
                      </div>
                      <div>
                        <span className="text-[11px] text-sky-200/70 block">Coluna d'Água Útil (100%)</span>
                        <span className="text-xl font-bold text-sky-300 font-mono-code">
                          {MAX_COLUMN_CM} cm
                        </span>
                      </div>
                      <div>
                        <span className="text-[11px] text-sky-200/70 block">Capacidade Útil (Litragem)</span>
                        <span className="text-2xl font-extrabold text-emerald-300 font-mono-code">
                          {maxVolumeLiters} Litros
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* PASSO 3: NÍVEIS DE ÁGUA E ALERTAS */}
                {wizardStep === 3 && (
                  <div className="space-y-6">
                    <div>
                      <span className="text-xs font-semibold uppercase tracking-wider text-sky-400">
                        Passo 3 de 6 • Monitoramento de Volume
                      </span>
                      <h3 className="text-xl font-bold text-white mt-1">
                        Determinar Níveis de Água e Alertas
                      </h3>
                      <p className="text-xs sm:text-sm text-sky-200/75 mt-1">
                        Escolha em quais porcentagens o sistema deve avisar que o nível está baixo, crítico ou muito cheio.
                      </p>
                    </div>

                    <div className="space-y-5">
                      <div className="bg-[#06101E]/85 border border-rose-500/30 rounded-2xl p-4">
                        <div className="flex justify-between items-center mb-2">
                          <div>
                            <span className="text-sm font-bold text-rose-300 block">
                              Nível Crítico (Repor Água Imediatamente)
                            </span>
                            <span className="text-xs text-sky-200/70">
                              Abaixo deste valor um banner vermelho piscante é exibido no topo.
                            </span>
                          </div>
                          <span className="text-lg font-extrabold font-mono-code text-rose-400">
                            {draftConfig.criticalLevelPct}% (
                            {((Number(draftConfig.criticalLevelPct) / 100) * Number(maxVolumeLiters)).toFixed(2)} L)
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

                      <div className="bg-[#06101E]/85 border border-amber-500/30 rounded-2xl p-4">
                        <div className="flex justify-between items-center mb-2">
                          <div>
                            <span className="text-sm font-bold text-amber-300 block">
                              Nível de Atenção (Evaporação / Nível Baixo)
                            </span>
                            <span className="text-xs text-sky-200/70">
                              Indica que a água começou a baixar do nível ideal.
                            </span>
                          </div>
                          <span className="text-lg font-extrabold font-mono-code text-amber-300">
                            {draftConfig.warningLevelPct}% (
                            {((Number(draftConfig.warningLevelPct) / 100) * Number(maxVolumeLiters)).toFixed(2)} L)
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

                      <div className="bg-[#06101E]/85 border border-sky-400/30 rounded-2xl p-4">
                        <div className="flex justify-between items-center mb-2">
                          <div>
                            <span className="text-sm font-bold text-sky-300 block">
                              Alerta de Nível Muito Cheio (Risco de Transbordo)
                            </span>
                            <span className="text-xs text-sky-200/70">
                              Acima deste percentual o painel avisa que o aquário está cheio demais.
                            </span>
                          </div>
                          <span className="text-lg font-extrabold font-mono-code text-sky-300">
                            {draftConfig.maxAlertLevelPct}% (
                            {((Number(draftConfig.maxAlertLevelPct) / 100) * Number(maxVolumeLiters)).toFixed(2)} L)
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
                )}

                {/* PASSO 4: TEMPERATURA IDEAL */}
                {wizardStep === 4 && (
                  <div className="space-y-6">
                    <div>
                      <span className="text-xs font-semibold uppercase tracking-wider text-sky-400">
                        Passo 4 de 6 • Clima da Água
                      </span>
                      <h3 className="text-xl font-bold text-white mt-1">
                        Configuração da Temperatura Ideal
                      </h3>
                      <p className="text-xs sm:text-sm text-sky-200/75 mt-1">
                        Escolha um perfil rápido conforme os seus peixes ou personalize a temperatura mínima e máxima.
                      </p>
                    </div>

                    {/* Perfis rápidos de espécies */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {[
                        { label: 'Peixes Tropicais', sub: '24°C a 28°C', min: 24, max: 28 },
                        { label: 'Comunitário Padrão', sub: '22°C a 29°C', min: 22, max: 29 },
                        { label: 'Água Fria / Carpas', sub: '18°C a 23°C', min: 18, max: 23 },
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
                            className={`p-4 rounded-2xl border text-left transition ${
                              selected
                                ? 'bg-[#1A539B] border-sky-300 text-white shadow-md'
                                : 'bg-[#06101E]/80 border-[#1A539B]/40 text-sky-200 hover:bg-[#0F2747]'
                            }`}
                          >
                            <div className="text-sm font-bold">{preset.label}</div>
                            <div className="text-xs text-emerald-300 font-mono-code mt-0.5">
                              {preset.sub}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="bg-[#06101E] border border-[#1A539B]/50 rounded-2xl p-4">
                        <label className="block text-xs font-semibold text-sky-300 mb-2">
                          Temperatura Mínima Ideal (°C)
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
                          className="w-full bg-[#0B1D35] border border-[#1A539B] rounded-xl px-4 py-2.5 text-lg font-bold font-mono-code text-white"
                        />
                        <span className="text-[11px] text-sky-200/60 mt-1.5 block">
                          Abaixo de {draftConfig.tempMinC}°C exibe alerta de "Água Fria".
                        </span>
                      </div>

                      <div className="bg-[#06101E] border border-[#1A539B]/50 rounded-2xl p-4">
                        <label className="block text-xs font-semibold text-rose-300 mb-2">
                          Temperatura Máxima Ideal (°C)
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
                          className="w-full bg-[#0B1D35] border border-[#1A539B] rounded-xl px-4 py-2.5 text-lg font-bold font-mono-code text-white"
                        />
                        <span className="text-[11px] text-sky-200/60 mt-1.5 block">
                          Acima de {draftConfig.tempMaxC}°C exibe alerta de "Água Quente".
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* PASSO 5: DISPLAY LCD */}
                {wizardStep === 5 && (
                  <div className="space-y-6">
                    <div>
                      <span className="text-xs font-semibold uppercase tracking-wider text-sky-400">
                        Passo 5 de 6 • Visor do Aquário
                      </span>
                      <h3 className="text-xl font-bold text-white mt-1">
                        O que será mostrado no Display LCD
                      </h3>
                      <p className="text-xs sm:text-sm text-sky-200/75 mt-1">
                        Personalize as duas linhas do visor (limite de 16 caracteres por linha) ou ative a alternância automática.
                      </p>
                    </div>

                    {/* Prévia ao vivo do Display LCD */}
                    <div className="rounded-2xl bg-[#050D1A] border-2 border-[#1A539B]/70 p-4 shadow-inner">
                      <div className="text-[11px] text-sky-300/80 mb-2 flex justify-between">
                        <span>Prévia em Tempo Real do Display LCD</span>
                        {draftConfig.lcdCarousel && (
                          <span className="text-emerald-300 font-semibold">
                            Alternando telas a cada 4s
                          </span>
                        )}
                      </div>
                      <div className="rounded-xl bg-gradient-to-b from-[#0E3B2E] to-[#092920] border-2 border-emerald-400/40 px-5 py-4 shadow-[inset_0_0_24px_rgba(16,185,129,0.25)]">
                        <div className="font-mono-code text-xl sm:text-2xl font-bold tracking-[0.18em] text-emerald-200 whitespace-pre">
                          {lcdLine0}
                        </div>
                        <div className="font-mono-code text-xl sm:text-2xl font-bold tracking-[0.18em] text-emerald-200 whitespace-pre mt-1.5">
                          {lcdLine1}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-sky-200 mb-1.5">
                          Informação da Linha 1 (Superior)
                        </label>
                        <select
                          value={draftConfig.lcdLine1Mode}
                          onChange={(e) =>
                            setDraftConfig({ ...draftConfig, lcdLine1Mode: e.target.value })
                          }
                          className="w-full bg-[#06101E] border border-[#1A539B]/60 rounded-xl px-4 py-2.5 text-sm text-white"
                        >
                          <option value="water_pct">Nível da Água em % (Ex: Nivel Agua: 85%)</option>
                          <option value="volume_liters">Volume Atual em Litros (Ex: Volume: 4.4 L)</option>
                          <option value="rtc_time">Horário do Relógio RTC (Ex: Hora: 08:35:00)</option>
                          <option value="custom_title">Texto Personalizado (Até 16 letras)</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-sky-200 mb-1.5">
                          Informação da Linha 2 (Inferior)
                        </label>
                        <select
                          value={draftConfig.lcdLine2Mode}
                          onChange={(e) =>
                            setDraftConfig({ ...draftConfig, lcdLine2Mode: e.target.value })
                          }
                          className="w-full bg-[#06101E] border border-[#1A539B]/60 rounded-xl px-4 py-2.5 text-sm text-white"
                        >
                          <option value="temp_c">Temperatura em °C (Ex: Temp: 26.0 C)</option>
                          <option value="rtc_time">Horário do Relógio RTC (Ex: Hora: 08:35:00)</option>
                          <option value="pump_status">Status da Bomba (Aberta / Fechada)</option>
                          <option value="next_feed">Próximo Horário de Comida</option>
                        </select>
                      </div>

                      {draftConfig.lcdLine1Mode === 'custom_title' && (
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-semibold text-sky-200 mb-1.5">
                            Texto Personalizado da Linha 1 (Máximo 16 caracteres, sem acento)
                          </label>
                          <input
                            type="text"
                            maxLength={16}
                            value={draftConfig.lcdCustomText}
                            onChange={(e) =>
                              setDraftConfig({ ...draftConfig, lcdCustomText: e.target.value })
                            }
                            className="w-full bg-[#06101E] border border-[#1A539B]/60 rounded-xl px-4 py-2.5 text-sm font-mono-code uppercase text-white"
                            placeholder="NETUNO AQUARIO"
                          />
                        </div>
                      )}

                      <div className="sm:col-span-2 bg-[#06101E]/85 border border-[#1A539B]/40 rounded-2xl p-4 flex items-center justify-between">
                        <div>
                          <span className="text-sm font-bold text-white block">
                            Modo Carrossel (Alternar Informações Automaticamente)
                          </span>
                          <span className="text-xs text-sky-200/70">
                            Alterna a cada 4 segundos entre Nível/Temperatura e Litragem/Bomba de Oxigênio.
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

                {/* PASSO 6: BOMBA DE OXIGÊNIO E CONFIGURAÇÃO DA COMIDA */}
                {wizardStep === 6 && (
                  <div className="space-y-6">
                    <div>
                      <span className="text-xs font-semibold uppercase tracking-wider text-sky-400">
                        Passo 6 de 6 • Relógio RTC, Oxigenação e Alimentação
                      </span>
                      <h3 className="text-xl font-bold text-white mt-1">
                        Configuração do Módulo RTC, Bomba de Oxigênio e Alimentador
                      </h3>
                      <p className="text-xs sm:text-sm text-sky-200/75 mt-1">
                        Ajuste o horário gravado no módulo RTC e programe o alimentador (que dispara com base no horário do RTC).
                      </p>
                    </div>

                    {/* Bloco 0: Configuração de Data e Horário do Módulo RTC */}
                    <div className="bg-[#06101E]/85 border border-sky-400/40 rounded-2xl p-5 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <h4 className="text-base font-bold text-white flex items-center gap-2">
                            <Clock className="w-4 h-4 text-sky-400" />
                            Configuração de Horário do Módulo RTC
                          </h4>
                          <p className="text-xs text-sky-200/70">
                            Defina a data e a hora exatas que ficarão salvas no módulo RTC do ESP32 ou sincronize com o relógio atual.
                          </p>
                        </div>

                        <div className="px-3.5 py-2 rounded-xl bg-[#0B1D35] border border-sky-400/30 text-right">
                          <span className="text-[10px] uppercase tracking-wider text-sky-300/80 block">
                            Horário Atual no RTC
                          </span>
                          <span className="font-mono-code text-base font-extrabold text-emerald-300">
                            {rtcTimeFormatted} • {rtcDateFormatted}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                        <div>
                          <label className="block text-xs font-semibold text-sky-200 mb-1">
                            Data do Módulo RTC
                          </label>
                          <input
                            type="date"
                            value={rtcEditDate}
                            onChange={(e) => setRtcEditDate(e.target.value)}
                            className="w-full bg-[#0B1D35] border border-[#1A539B] rounded-xl px-3 py-2 text-xs font-mono-code text-white"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-sky-200 mb-1">
                            Horário do Módulo RTC (HH:MM:SS)
                          </label>
                          <input
                            type="time"
                            step="1"
                            value={rtcEditTime}
                            onChange={(e) => setRtcEditTime(e.target.value)}
                            className="w-full bg-[#0B1D35] border border-[#1A539B] rounded-xl px-3 py-2 text-xs font-mono-code text-white"
                          />
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => handleApplyRtcDateTime(null)}
                            className="flex-1 py-2 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-extrabold transition"
                          >
                            Gravar Horário no RTC
                          </button>
                          <button
                            type="button"
                            onClick={() => handleApplyRtcDateTime(new Date().toISOString())}
                            className="py-2 px-3 rounded-xl bg-[#1A539B] hover:bg-[#2364B8] text-white text-xs font-bold border border-sky-300/30 transition"
                            title="Puxa a data e hora atuais do navegador/celular e grava no RTC"
                          >
                            Usar Hora Atual
                          </button>
                        </div>
                      </div>

                      {rtcSaveNotice && (
                        <div className="text-xs text-emerald-300 flex items-center gap-1.5 font-semibold">
                          <CheckCircle2 className="w-4 h-4" />
                          Horário enviado e atualizado no módulo RTC com sucesso!
                        </div>
                      )}
                    </div>

                    {/* Bloco 1: Bomba de Oxigênio */}
                    <div className="bg-[#06101E]/85 border border-[#1A539B]/50 rounded-2xl p-5 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <h4 className="text-base font-bold text-white flex items-center gap-2">
                            <Wind className="w-4 h-4 text-sky-400" />
                            Bomba de Oxigênio ({pumpRelayOn ? 'Aberta' : 'Fechada'})
                          </h4>
                          <p className="text-xs text-sky-200/70">
                            Defina o modo de operação e a proteção contra funcionamento a seco
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={handleTogglePump}
                          className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition ${
                            pumpRelayOn
                              ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                              : 'bg-[#1A539B] text-white border border-sky-300/30'
                          }`}
                        >
                          <Power className="w-4 h-4" />
                          {pumpRelayOn ? 'Bomba Aberta (Fechar)' : 'Bomba Fechada (Abrir)'}
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                        <div>
                          <label className="block text-xs font-semibold text-sky-200 mb-1">
                            Modo de Operação
                          </label>
                          <select
                            value={draftConfig.pumpMode}
                            onChange={(e) =>
                              setDraftConfig({ ...draftConfig, pumpMode: e.target.value })
                            }
                            className="w-full bg-[#0B1D35] border border-[#1A539B] rounded-xl px-3 py-2 text-xs text-white"
                          >
                            <option value="auto">Ciclo Automático</option>
                            <option value="manual">Manual Fixo</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-sky-200 mb-1">
                            Tempo Aberta no Ciclo (min)
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
                            className="w-full bg-[#0B1D35] border border-[#1A539B] rounded-xl px-3 py-2 text-xs font-mono-code text-white"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-sky-200 mb-1">
                            Desligamento Segurança (&lt; %)
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
                            className="w-full bg-[#0B1D35] border border-[#1A539B] rounded-xl px-3 py-2 text-xs font-mono-code text-white"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Bloco 2: Alimentador e Horários */}
                    <div className="bg-[#06101E]/85 border border-[#1A539B]/50 rounded-2xl p-5 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <h4 className="text-base font-bold text-white flex items-center gap-2">
                            <Utensils className="w-4 h-4 text-sky-400" />
                            Configuração da Comida (Alimentador)
                          </h4>
                          <p className="text-xs text-sky-200/70">
                            Porção padrão, teste imediato e horários programados (máx. 8 por dia)
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleTriggerFeedNow(draftConfig.defaultPortion)}
                          disabled={feedNowCommand}
                          className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition ${
                            feedNowCommand
                              ? 'bg-amber-400 text-slate-950 animate-pulse'
                              : 'bg-gradient-to-r from-[#1A539B] to-sky-500 text-white'
                          }`}
                        >
                          <Utensils className="w-4 h-4" />
                          {feedNowCommand
                            ? 'Dispensando Ração...'
                            : `Alimentar Agora (${draftConfig.defaultPortion})`}
                        </button>
                      </div>

                      {/* Seleção de porção padrão */}
                      <div className="grid grid-cols-3 gap-2">
                        {['Leve (3g)', 'Padrão (5g)', 'Generosa (8g)'].map((portion) => (
                          <button
                            key={portion}
                            type="button"
                            onClick={() =>
                              setDraftConfig({ ...draftConfig, defaultPortion: portion })
                            }
                            className={`py-2.5 px-3 rounded-xl text-xs font-semibold border transition ${
                              draftConfig.defaultPortion === portion
                                ? 'bg-[#1A539B] border-sky-400 text-white'
                                : 'bg-[#0B1D35] border-[#1A539B]/40 text-sky-200/70'
                            }`}
                          >
                            {portion}
                          </button>
                        ))}
                      </div>

                      {/* Lista de horários programados */}
                      <div className="space-y-2 pt-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-xs font-semibold text-sky-200 flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-sky-400" />
                            Horários Programados (Acionados pelo Relógio do Módulo RTC) ({schedules.length}/8)
                          </div>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-sky-200/75">
                              Hora base do RTC: <strong className="font-mono-code text-emerald-300">{rtcTimeFormatted}</strong>
                            </span>
                            {nextSchedule && (
                              <span className="px-2 py-0.5 rounded-md bg-sky-500/20 border border-sky-400/30 text-sky-200 text-[11px] font-mono-code">
                                Próx. refeição pelo RTC: {nextSchedule.time}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {schedules.map((item) => (
                            <div
                              key={item.id}
                              className="bg-[#0B1D35] border border-[#1A539B]/50 rounded-xl p-3 flex items-center justify-between"
                            >
                              <div>
                                <span className="text-base font-extrabold font-mono-code text-white">
                                  {item.time}
                                </span>
                                <span className="text-xs text-sky-300 block">{item.portion}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleToggleSchedule(item.id)}
                                  className={`w-9 h-5 rounded-full p-0.5 transition ${
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
                                  type="button"
                                  onClick={() => handleDeleteSchedule(item.id)}
                                  className="p-1 text-rose-400 hover:text-rose-300"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>

                        {schedules.length < 8 && (
                          <form onSubmit={handleAddSchedule} className="flex flex-wrap gap-2 pt-2">
                            <input
                              type="time"
                              value={newScheduleTime}
                              onChange={(e) => setNewScheduleTime(e.target.value)}
                              className="bg-[#0B1D35] border border-[#1A539B] rounded-xl px-3 py-2 text-xs font-mono-code text-white"
                            />
                            <select
                              value={newSchedulePortion}
                              onChange={(e) => setNewSchedulePortion(e.target.value)}
                              className="bg-[#0B1D35] border border-[#1A539B] rounded-xl px-3 py-2 text-xs text-white flex-1"
                            >
                              <option value="Leve (3g)">Leve (3g)</option>
                              <option value="Padrão (5g)">Padrão (5g)</option>
                              <option value="Generosa (8g)">Generosa (8g)</option>
                            </select>
                            <button
                              type="submit"
                              className="bg-[#1A539B] hover:bg-[#2364B8] text-white text-xs font-bold px-4 py-2 rounded-xl flex items-center gap-1"
                            >
                              <Plus className="w-3.5 h-3.5" /> Adicionar Horário
                            </button>
                          </form>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Rodapé de Navegação Entre os Passos do Assistente */}
                <div className="pt-5 border-t border-[#1A539B]/40 flex items-center justify-between">
                  <button
                    type="button"
                    disabled={wizardStep === 1}
                    onClick={() => setWizardStep((s) => Math.max(1, s - 1))}
                    className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold border transition ${
                      wizardStep === 1
                        ? 'opacity-40 cursor-not-allowed bg-[#06101E] border-slate-800 text-slate-500'
                        : 'bg-[#06101E] border-[#1A539B] text-sky-200 hover:bg-[#0F2747]'
                    }`}
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Passo Anterior
                  </button>

                  {wizardStep < 6 ? (
                    <button
                      type="button"
                      onClick={() => setWizardStep((s) => Math.min(6, s + 1))}
                      className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-[#1A539B] hover:bg-[#2364B8] text-white text-xs font-bold border border-sky-300/30 shadow-md transition"
                    >
                      Próximo Passo
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSaveWizardConfig}
                      className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-extrabold shadow-lg shadow-emerald-500/25 transition"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Concluir e Salvar Configurações
                    </button>
                  )}
                </div>
              </div>
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
