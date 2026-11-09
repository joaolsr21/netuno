import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../config/supabase';
import { bleService } from '../services/bleService';

const INITIAL_SCHEDULES = [
  { id: 1, time: '08:00', portion: 'Padrão (5g)', label: 'Manhã', enabled: true },
  { id: 2, time: '14:00', portion: 'Leve (3g)', label: 'Tarde', enabled: true },
  { id: 3, time: '20:00', portion: 'Padrão (5g)', label: 'Noite', enabled: true },
];

const INITIAL_LOGS = [
  { id: 1, time: '08:00', type: 'feeder', message: 'Alimentador acionado (Padrão 5g)', source: 'Sistema' },
  { id: 2, time: '07:45', type: 'sensor', message: 'Nível estabilizado em 85%', source: 'Sistema' },
  { id: 3, time: '06:00', type: 'pump', message: 'Bomba de oxigênio aberta (Ciclo Auto)', source: 'Sistema' },
];

export function useAquariumConnection() {
  // Canal ativo: 'wifi' (Supabase) | 'bluetooth' (BLE Direto ESP32)
  const [transport, setTransport] = useState('wifi');
  const [wifiAvailable, setWifiAvailable] = useState(true);
  const [bleConnected, setBleConnected] = useState(false);
  const [bleStatusText, setBleStatusText] = useState('Aguardando');

  // Telemetria e Atuadores
  const [waterLevelPct, setWaterLevelPct] = useState(null);
  const [distanceCm, setDistanceCm] = useState(null);
  const [temperatureC, setTemperatureC] = useState(null);
  const [rtcTimestamp, setRtcTimestamp] = useState(() => new Date().toISOString());
  const [pumpRelayOn, setPumpRelayOn] = useState(true);
  const [pumpMode, setPumpMode] = useState('auto');
  const [isFeeding, setIsFeeding] = useState(false);
  const [schedules, setSchedules] = useState(INITIAL_SCHEDULES);
  const [logs, setLogs] = useState([]);
  const [history, setHistory] = useState([]);

  // Avança o relógio do módulo RTC a cada 1 segundo no app mobile
  useEffect(() => {
    const timer = setInterval(() => {
      setRtcTimestamp((prev) => {
        const base = prev ? new Date(prev).getTime() : Date.now();
        return new Date(base + 1000).toISOString();
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Fila Offline resgatada do ESP32 pelo celular (para repassar ao Supabase via 4G/5G)
  const [pendingPhoneSync, setPendingPhoneSync] = useState([]);
  const rescuedBufferRef = useRef([]);

  const addLocalLog = useCallback((type, message, source) => {
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    setLogs((prev) => [{ id: Date.now() + Math.random(), time: timeStr, type, message, source }, ...prev.slice(0, 19)]);
  }, []);

  // ==========================================================================
  // 1. CONEXÃO BLUETOOTH (BLE) — ATIVADA QUANDO O WI-FI DO ESP32 CAI
  // ==========================================================================
  const connectBluetooth = useCallback(async () => {
    setBleStatusText('Buscando NETUNO_ESP32...');
    try {
      await bleService.connectToEsp32({
        onTelemetry: (data) => {
          if (typeof data.water_level_pct === 'number') setWaterLevelPct(data.water_level_pct);
          if (typeof data.distance_cm === 'number') setDistanceCm(data.distance_cm);
          if (typeof data.pump_relay_on === 'boolean') setPumpRelayOn(data.pump_relay_on);
          if (data.pump_mode) setPumpMode(data.pump_mode);
        },
        onOfflineRecord: (record) => {
          rescuedBufferRef.current.push(record);
        },
        onOfflineSyncComplete: async () => {
          const items = [...rescuedBufferRef.current];
          rescuedBufferRef.current = [];
          if (items.length === 0) return;

          addLocalLog('sync', `${items.length} registro(s) offline recebidos via Bluetooth`, 'Bluetooth APK');

          // Tenta enviar os dados resgatados para o Supabase usando a internet (4G/5G) do celular
          if (isSupabaseConfigured && supabase) {
            const { error } = await supabase.from('telemetry_logs').insert(items);
            if (!error) {
              await bleService.sendCommand('CLEAR_OFFLINE');
              setPendingPhoneSync([]);
              addLocalLog('sync', 'Fila offline sincronizada do celular para o Supabase!', '4G/5G -> Supabase');
              return;
            }
          }
          setPendingPhoneSync((prev) => [...prev, ...items]);
        },
        onDisconnect: () => {
          setBleConnected(false);
          setBleStatusText('Desconectado');
        },
      });

      setBleConnected(true);
      setTransport('bluetooth');
      setBleStatusText('Conectado via BLE ao ESP32');
      addLocalLog('sync', 'Chaveado para Bluetooth (BLE Direto com ESP32)', 'Bluetooth APK');

      // Assim que conecta no BLE, pede ao ESP32 qualquer dado que tenha ficado salvo offline
      await bleService.sendCommand('SYNC_OFFLINE');
    } catch (err) {
      // Modo demonstração caso esteja testando sem o hardware físico ligado
      setBleConnected(true);
      setTransport('bluetooth');
      setBleStatusText(
        err.message === 'BLE_NATIVE_UNAVAILABLE'
          ? 'Modo Simulação BLE (Gere o .APK p/ BLE real)'
          : 'Modo Simulação BLE (ESP32 fora de alcance)'
      );
      addLocalLog('sync', 'Operando em Modo Bluetooth (Simulação Base)', 'Bluetooth APK');
    }
  }, [addLocalLog]);

  // ==========================================================================
  // 2. MONITORAMENTO WI-FI / SUPABASE + FAILOVER AUTOMÁTICO PARA BLUETOOTH
  // ==========================================================================
  const fetchFromSupabase = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;

    const { data, error } = await supabase.from('aquarium_status').select('*').eq('id', 1).maybeSingle();
    if (!error && data) {
      if (data.pump_relay_on !== undefined && data.pump_relay_on !== null) {
        setPumpRelayOn(Boolean(data.pump_relay_on));
      }
      if (data.pump_mode) {
        setPumpMode(data.pump_mode);
      }
      if (data.rtc_datetime) {
        setRtcTimestamp(data.rtc_datetime);
      }
      const espEverSent = Number(data.distance_cm) > 0 || Number(data.water_level_pct) > 0;
      if (espEverSent) {
        if (data.water_level_pct !== undefined && data.water_level_pct !== null) {
          setWaterLevelPct(Number(data.water_level_pct));
        }
        if (data.distance_cm !== undefined && data.distance_cm !== null) {
          setDistanceCm(Number(data.distance_cm));
        }
        if (data.temperature_c !== undefined && data.temperature_c !== null) {
          setTemperatureC(Number(data.temperature_c));
        }
      }
      const ageSeconds = (Date.now() - new Date(data.esp_last_seen).getTime()) / 1000;
      setWifiAvailable(ageSeconds < 25);
      if (ageSeconds < 25) setTransport('wifi');
    }

    const { data: scheduleData } = await supabase
      .from('feed_schedules')
      .select('*')
      .order('time', { ascending: true });
    if (scheduleData) {
      setSchedules(scheduleData);
    }

    const { data: logData } = await supabase
      .from('telemetry_logs')
      .select('*')
      .order('recorded_at', { ascending: false })
      .limit(20);

    if (logData) {
      const formatTime = (iso) => {
        if (!iso) return '--:--';
        const d = new Date(iso);
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      };
      setLogs(
        logData.map((l) => ({
          id: l.id,
          time: formatTime(l.recorded_at),
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
          time: formatTime(l.recorded_at),
          level: Number(l.water_level_pct),
          temp: l.temperature_c !== null && l.temperature_c !== undefined ? Number(l.temperature_c) : null,
        }));
      setHistory(recentPoints);
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;

    fetchFromSupabase();

    const channel = supabase
      .channel('netuno-apk-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'aquarium_status' }, (payload) => {
        const s = payload.new;
        if (!s) return;
        if (s.water_level_pct !== undefined && s.water_level_pct !== null) setWaterLevelPct(Number(s.water_level_pct));
        if (s.distance_cm !== undefined && s.distance_cm !== null) setDistanceCm(Number(s.distance_cm));
        if (s.temperature_c !== undefined && s.temperature_c !== null) setTemperatureC(Number(s.temperature_c));
        if (s.rtc_datetime) setRtcTimestamp(s.rtc_datetime);
        if (s.pump_relay_on !== undefined && s.pump_relay_on !== null) setPumpRelayOn(Boolean(s.pump_relay_on));
        if (s.pump_mode) setPumpMode(s.pump_mode);
        setWifiAvailable(true);
        setTransport('wifi');
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'telemetry_logs' }, () => {
        fetchFromSupabase();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchFromSupabase]);

  // ==========================================================================
  // 3. AÇÕES HÍBRIDAS (USAM WI-FI QUANDO NORMAL OU BLUETOOTH QUANDO CAI)
  // ==========================================================================
  const togglePump = async () => {
    const next = !pumpRelayOn;
    setPumpRelayOn(next);

    if (transport === 'wifi' && wifiAvailable) {
      if (isSupabaseConfigured && supabase) {
        await supabase.from('aquarium_status').update({ pump_relay_on: next }).eq('id', 1);
      }
      addLocalLog('pump', `Relé ${next ? 'LIGADO' : 'DESLIGADO'} via Wi-Fi`, 'APK -> Supabase');
    } else {
      await bleService.sendCommand('PUMP_TOGGLE').catch(() => {});
      addLocalLog('pump', `Relé ${next ? 'LIGADO' : 'DESLIGADO'} via Bluetooth`, 'APK -> BLE Direto');
    }
  };

  const changePumpMode = async (mode) => {
    setPumpMode(mode);
    if (transport === 'wifi' && wifiAvailable) {
      if (isSupabaseConfigured && supabase) {
        await supabase.from('aquarium_status').update({ pump_mode: mode }).eq('id', 1);
      }
    } else {
      await bleService.sendCommand(mode === 'auto' ? 'MODE_AUTO' : 'MODE_MANUAL').catch(() => {});
    }
  };

  const feedNow = async (portion = 'Padrão (5g)') => {
    if (isFeeding) return;
    setIsFeeding(true);

    if (transport === 'wifi' && wifiAvailable) {
      if (isSupabaseConfigured && supabase) {
        await supabase
          .from('aquarium_status')
          .update({ feed_now_command: true, feed_now_portion: portion })
          .eq('id', 1);
      }
      addLocalLog('feeder', `Alimentação (${portion}) enviada via Wi-Fi`, 'APK -> Supabase');
    } else {
      await bleService.sendCommand(`FEED:${portion}`).catch(() => {});
      addLocalLog('feeder', `Alimentação (${portion}) enviada via Bluetooth`, 'APK -> BLE Direto');
    }

    setTimeout(() => setIsFeeding(false), 2200);
  };

  // Alternador para você simular queda/volta do Wi-Fi direto na tela do celular
  const simulateWifiDropOrRestore = async () => {
    if (wifiAvailable) {
      setWifiAvailable(false);
      await connectBluetooth();
    } else {
      await bleService.disconnect().catch(() => {});
      setBleConnected(false);
      setWifiAvailable(true);
      setTransport('wifi');
      addLocalLog('sync', 'Wi-Fi restabelecido! Retornando ao modo Nuvem (Supabase).', 'Wi-Fi Supabase');
    }
  };

  const addSchedule = (time, portion) => {
    const item = { id: Date.now(), time, portion, label: 'Personalizado', enabled: true };
    setSchedules((prev) => [...prev, item].sort((a, b) => a.time.localeCompare(b.time)));
    addLocalLog('feeder', `Horário ${time} (${portion}) agendado`, transport === 'wifi' ? 'Wi-Fi' : 'Bluetooth');
  };

  const toggleSchedule = (id) => {
    setSchedules((prev) => prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)));
  };

  const deleteSchedule = async (id) => {
    setSchedules((prev) => prev.filter((s) => s.id !== id));
    if (isSupabaseConfigured && supabase) {
      await supabase.from('feed_schedules').delete().eq('id', id).catch(() => {});
    }
  };

  const applyRtcDateTime = async (isoString) => {
    const targetIso = isoString || new Date().toISOString();
    setRtcTimestamp(targetIso);
    if (isSupabaseConfigured && supabase) {
      await supabase
        .from('aquarium_status')
        .update({ rtc_datetime: targetIso, rtc_set_command: true })
        .eq('id', 1)
        .catch(() => {});
    }
  };

  const triggerWifiSetupCommand = async () => {
    if (isSupabaseConfigured && supabase) {
      await supabase
        .from('aquarium_status')
        .update({ wifi_setup_command: true })
        .eq('id', 1)
        .catch(() => {});
    }
  };

  const updateSimulatedWaterLevel = (pct) => {
    const clamped = Math.max(10, Math.min(98, pct));
    setWaterLevelPct(clamped);
    const col = (clamped / 100) * 38;
    setDistanceCm(Number((40 - col).toFixed(1)));
  };

  return {
    transport,
    wifiAvailable,
    bleConnected,
    bleStatusText,
    waterLevelPct,
    distanceCm,
    temperatureC,
    rtcTimestamp,
    setRtcTimestamp,
    pumpRelayOn,
    pumpMode,
    isFeeding,
    schedules,
    logs,
    history,
    pendingPhoneSync,
    isSupabaseConfigured,
    fetchFromSupabase,
    togglePump,
    changePumpMode,
    feedNow,
    connectBluetooth,
    simulateWifiDropOrRestore,
    addSchedule,
    toggleSchedule,
    deleteSchedule,
    applyRtcDateTime,
    triggerWifiSetupCommand,
    updateSimulatedWaterLevel,
  };
}
