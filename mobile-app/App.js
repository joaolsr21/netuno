import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Image,
  SafeAreaView,
  TextInput,
  Platform,
  StatusBar as RNStatusBar,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useAquariumConnection } from './src/hooks/useAquariumConnection';

const DEFAULT_CONFIG = {
  wifiSsid: 'Iphone de JL',
  wifiPassword: '',
  wifiApName: 'NETUNO-SETUP',
  wifiPortalIp: '192.168.4.1',
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
  lcdLine1Mode: 'water_pct',
  lcdLine2Mode: 'temp_c',
  lcdCarousel: false,
  lcdCustomText: 'NETUNO AQUARIO',
  pumpMode: 'auto',
  pumpCycleOnMin: 45,
  pumpSafetyCutoffPct: 30,
  defaultPortion: 'Padrão (5g)',
  setupCompleted: true,
};

export default function App() {
  const {
    waterLevelPct,
    distanceCm,
    temperatureC,
    rtcTimestamp,
    pumpRelayOn,
    pumpMode,
    isFeeding,
    schedules,
    logs,
    history,
    fetchFromSupabase,
    togglePump,
    changePumpMode,
    feedNow,
    addSchedule,
    toggleSchedule,
    deleteSchedule,
    applyRtcDateTime,
    triggerWifiSetupCommand,
  } = useAquariumConnection();

  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [draftConfig, setDraftConfig] = useState(DEFAULT_CONFIG);
  const [wizardStep, setWizardStep] = useState(1); // 1 a 6
  const [exclusiveSetupMode, setExclusiveSetupMode] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard' | 'setup' | 'history'
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showWifiPassword, setShowWifiPassword] = useState(false);
  const [carouselTick, setCarouselTick] = useState(0);

  // Campos de edição do RTC e Alimentador
  const [rtcEditDate, setRtcEditDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rtcEditTime, setRtcEditTime] = useState(() => new Date().toTimeString().slice(0, 8));
  const [rtcSaveNotice, setRtcSaveNotice] = useState(false);
  const [newScheduleTime, setNewScheduleTime] = useState('18:00');
  const [newSchedulePortion, setNewSchedulePortion] = useState('Padrão (5g)');
  const [lastAutoFedMinuteKey, setLastAutoFedMinuteKey] = useState('');

  const availableNetworks = [
    { ssid: 'Iphone de JL', signal: 'Forte', security: 'WPA2-PSK' },
    { ssid: 'Casa_Fibra_2.4G', signal: 'Bom', security: 'WPA2-PSK' },
    { ssid: 'Netuno_Guest', signal: 'Médio', security: 'WPA2-PSK' },
  ];

  // Formatação de data e hora do Módulo RTC
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

  // Dimensões dinâmicas a partir da configuração ativa
  const activeCfg = activeTab === 'setup' ? draftConfig : config;
  const TANK_LENGTH_CM = Math.max(5, Number(activeCfg.lengthCm) || 25);
  const TANK_WIDTH_CM = Math.max(5, Number(activeCfg.widthCm) || 13);
  const TANK_HEIGHT_CM = Math.max(8, Number(activeCfg.heightCm) || 18);
  const SENSOR_OFFSET_CM = Math.max(2, Math.min(15, Number(activeCfg.sensorOffsetCm) || 2));
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

  // Alternância do carrossel do Display LCD
  useEffect(() => {
    if (!activeCfg.lcdCarousel) {
      setCarouselTick(0);
      return;
    }
    const timer = setInterval(() => {
      setCarouselTick((prev) => (prev + 1) % 2);
    }, 4000);
    return () => clearInterval(timer);
  }, [activeCfg.lcdCarousel]);

  // Próximo horário de alimentação baseado no relógio do módulo RTC
  const activeSchedules = schedules
    .filter((s) => s.enabled)
    .sort((a, b) => a.time.localeCompare(b.time));

  const rtcCurrentHHMM = `${String(rtcDateObj.getHours()).padStart(2, '0')}:${String(
    rtcDateObj.getMinutes()
  ).padStart(2, '0')}`;
  const rtcCurrentSeconds = rtcDateObj.getSeconds();

  const nextSchedule =
    activeSchedules.find((s) => s.time > rtcCurrentHHMM) ||
    (activeSchedules.length > 0 ? activeSchedules[0] : null);

  // Disparo automático do alimentador quando o horário do módulo RTC atinge um horário programado
  useEffect(() => {
    if (rtcCurrentSeconds > 2) return;
    const match = activeSchedules.find((s) => s.time === rtcCurrentHHMM);
    if (!match) return;
    const minuteKey = `${rtcDateFormatted}_${rtcCurrentHHMM}`;
    if (lastAutoFedMinuteKey === minuteKey) return;
    setLastAutoFedMinuteKey(minuteKey);
    feedNow(match.portion);
  }, [
    rtcCurrentHHMM,
    rtcCurrentSeconds,
    rtcDateFormatted,
    activeSchedules,
    lastAutoFedMinuteKey,
    feedNow,
  ]);

  const getWaterStatus = (pct, cfg = activeCfg) => {
    if (pct === null)
      return { label: 'Sem leitura', color: '#CBD5E1', bg: 'rgba(100,116,139,0.2)' };
    if (pct < Number(cfg.criticalLevelPct))
      return { label: 'CRÍTICO — Repor Água', color: '#FB7185', bg: 'rgba(244,63,94,0.2)' };
    if (pct < Number(cfg.warningLevelPct))
      return { label: 'ATENÇÃO — Nível Baixo', color: '#FCD34D', bg: 'rgba(245,158,11,0.2)' };
    if (pct > Number(cfg.maxAlertLevelPct))
      return { label: 'ALERTA — Muito Cheio', color: '#FCD34D', bg: 'rgba(245,158,11,0.2)' };
    return { label: 'IDEAL — Estável', color: '#6EE7B7', bg: 'rgba(16,185,129,0.2)' };
  };

  const getTempStatus = (temp, cfg = activeCfg) => {
    if (temp === null)
      return { label: 'Sem leitura', color: '#CBD5E1', bg: 'rgba(100,116,139,0.2)' };
    if (temp < Number(cfg.tempMinC))
      return { label: 'BAIXA — Água Fria', color: '#7DD3FC', bg: 'rgba(56,189,248,0.2)' };
    if (temp > Number(cfg.tempMaxC))
      return { label: 'ALTA — Água Quente', color: '#FB7185', bg: 'rgba(244,63,94,0.2)' };
    return {
      label: `IDEAL (${cfg.tempMinC}°C – ${cfg.tempMaxC}°C)`,
      color: '#6EE7B7',
      bg: 'rgba(16,185,129,0.2)',
    };
  };

  const waterStatus = getWaterStatus(waterLevelPct, activeCfg);
  const tempStatus = getTempStatus(temperatureC, activeCfg);

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

  const handleOpenExclusiveSetup = (step = 1) => {
    setDraftConfig(config);
    setWizardStep(step);
    setExclusiveSetupMode(true);
    setActiveTab('setup');
    triggerWifiSetupCommand();
  };

  const handleSaveWizard = () => {
    const finalCfg = { ...draftConfig, setupCompleted: true };
    setConfig(finalCfg);
    changePumpMode(finalCfg.pumpMode);
    setSaveSuccess(true);
    setTimeout(() => {
      setSaveSuccess(false);
      setExclusiveSetupMode(false);
      setActiveTab('dashboard');
    }, 1000);
  };

  const handleApplyRtcFromApp = (customIso = null) => {
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
    applyRtcDateTime(targetIso);
    setRtcSaveNotice(true);
    setTimeout(() => setRtcSaveNotice(false), 2500);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" backgroundColor="#06101E" />

      {/* ALERTA DE NÍVEL CRÍTICO */}
      {waterLevelPct !== null && waterLevelPct < Number(config.criticalLevelPct) && (
        <View style={styles.criticalBanner}>
          <Text style={styles.criticalBannerText}>
            ⚠️ Alerta de Nível: O nível da água está crítico ({waterLevelPct}%).
          </Text>
        </View>
      )}

      {/* CABEÇALHO DO APP ANDROID COM RELÓGIO FORA DE CARD NO CANTO SUPERIOR DIREITO */}
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <Image source={require('./assets/logo-netuno.jpg')} style={styles.logo} />
          <View>
            <Text style={styles.brandTitle}>NETUNO</Text>
            <Text style={styles.brandSub}>{config.aquariumName}</Text>
          </View>
        </View>

        <View style={styles.headerRight}>
          {!exclusiveSetupMode ? (
            <TouchableOpacity
              onPress={() => handleOpenExclusiveSetup(1)}
              style={styles.setupHeaderBtn}
            >
              <Text style={styles.setupHeaderBtnText}>Configurar Wi-Fi</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={() => {
                setExclusiveSetupMode(false);
                setActiveTab('dashboard');
              }}
              style={styles.backHeaderBtn}
            >
              <Text style={styles.backHeaderBtnText}>← Voltar</Text>
            </TouchableOpacity>
          )}

          {/* Relógio em Tempo Real (RTC) posicionado no canto superior direito */}
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.clockTimeText}>{rtcTimeFormatted}</Text>
            <Text style={styles.clockDateText}>{rtcDateFormatted}</Text>
          </View>
        </View>
      </View>

      {/* CONTEÚDO ROLÁVEL */}
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* RESUMO RÁPIDO DOS 4 INDICADORES (Sem card de Visor e sem card de Relógio) */}
        {!exclusiveSetupMode && (
          <View style={styles.summaryContainer}>
            <View style={styles.kpiGrid}>
              {/* Card 1: Nível d'Água */}
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>NÍVEL D'ÁGUA</Text>
                <Text style={styles.kpiValue}>
                  {waterLevelPct !== null ? `${waterLevelPct}%` : '--'}
                </Text>
                <Text style={styles.kpiSub}>{waterStatus.label}</Text>
              </View>

              {/* Card 2: Temperatura */}
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>TEMPERATURA</Text>
                <Text style={[styles.kpiValue, { color: '#6EE7B7' }]}>
                  {temperatureC !== null ? `${Number(temperatureC).toFixed(1)} °C` : '--'}
                </Text>
                <Text style={styles.kpiSub}>{tempStatus.label}</Text>
              </View>
            </View>

            <View style={styles.kpiGrid}>
              {/* Card 3: Bomba de Oxigênio */}
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>BOMBA DE OXIGÊNIO</Text>
                <Text
                  style={[
                    styles.kpiValue,
                    { color: pumpRelayOn ? '#6EE7B7' : '#FCD34D' },
                  ]}
                >
                  {pumpRelayOn ? 'Aberta' : 'Fechada'}
                </Text>
                <Text style={styles.kpiSub}>
                  Modo {pumpMode === 'auto' ? 'Automático' : 'Manual'}
                </Text>
              </View>

              {/* Card 4: Alimentador (Baseado no RTC) */}
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>ALIMENTADOR</Text>
                <Text style={[styles.kpiValue, { color: '#7DD3FC', fontSize: 19 }]}>
                  {isFeeding
                    ? 'Alimentando...'
                    : nextSchedule
                    ? `Próx: ${nextSchedule.time}`
                    : 'Programado'}
                </Text>
                <Text style={[styles.kpiSub, { color: '#6EE7B7' }]}>
                  {nextSchedule ? nextSchedule.portion : config.defaultPortion}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* ===================================================================
            ABA 1: PAINEL PRINCIPAL
           =================================================================== */}
        {!exclusiveSetupMode && activeTab === 'dashboard' && (
          <>
            {/* CARD: NÍVEL DA ÁGUA */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>Nível da Água</Text>
                  <Text style={styles.cardSubtitle}>
                    Capacidade útil: {maxVolumeLiters} Litros ({TANK_LENGTH_CM} × {TANK_WIDTH_CM} × {TANK_HEIGHT_CM} cm)
                  </Text>
                </View>
                <View style={[styles.statePill, { backgroundColor: waterStatus.bg }]}>
                  <Text style={[styles.statePillText, { color: waterStatus.color }]}>
                    {waterStatus.label}
                  </Text>
                </View>
              </View>

              <View style={styles.tankContainer}>
                <View
                  style={[
                    styles.waterFill,
                    { height: `${waterLevelPct !== null ? waterLevelPct : 0}%` },
                  ]}
                />
                <View style={styles.tankCenterOverlay}>
                  <Text style={styles.tankBigPct}>
                    {waterLevelPct !== null ? `${waterLevelPct}%` : '--'}
                  </Text>
                  {waterVolumeLiters !== null && (
                    <Text style={styles.tankVolumeText}>Volume: {waterVolumeLiters} L</Text>
                  )}
                </View>
              </View>

              <View style={styles.metricsRow}>
                <View style={styles.metricBox}>
                  <Text style={styles.metricLabel}>Nível Atual</Text>
                  <Text style={[styles.metricValue, { color: '#7DD3FC' }]}>
                    {waterLevelPct !== null ? `${waterLevelPct}%` : '--'}
                  </Text>
                </View>
                <View style={styles.metricBox}>
                  <Text style={styles.metricLabel}>Volume Atual</Text>
                  <Text style={styles.metricValue}>
                    {waterVolumeLiters !== null
                      ? `${waterVolumeLiters} / ${maxVolumeLiters} L`
                      : `-- / ${maxVolumeLiters} L`}
                  </Text>
                </View>
              </View>
            </View>

            {/* CARD: DISPLAY LCD */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>Display LCD</Text>
                <TouchableOpacity
                  onPress={() => {
                    setDraftConfig(config);
                    setWizardStep(5);
                    setActiveTab('setup');
                  }}
                >
                  <Text style={{ color: '#7DD3FC', fontSize: 12, fontWeight: '600' }}>
                    Personalizar visor →
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.lcdOuter}>
                <View style={styles.lcdScreen}>
                  <Text style={styles.lcdText}>{lcdLine0}</Text>
                  <Text style={[styles.lcdText, { marginTop: 6 }]}>{lcdLine1}</Text>
                </View>
              </View>
            </View>

            {/* CARD: TEMPERATURA DA ÁGUA */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>Temperatura da Água</Text>
                  <Text style={styles.cardSubtitle}>Monitoramento térmico em tempo real</Text>
                </View>
                <View style={[styles.statePill, { backgroundColor: tempStatus.bg }]}>
                  <Text style={[styles.statePillText, { color: tempStatus.color }]}>
                    {tempStatus.label}
                  </Text>
                </View>
              </View>

              <View style={styles.tempBox}>
                <View>
                  <Text style={styles.metricLabel}>Temperatura Atual</Text>
                  <Text style={styles.tempBigValue}>
                    {temperatureC !== null ? `${Number(temperatureC).toFixed(1)} °C` : '--'}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.metricLabel}>
                    Faixa Ideal:{' '}
                    <Text style={{ color: '#6EE7B7', fontWeight: '700' }}>
                      {config.tempMinC}°C – {config.tempMaxC}°C
                    </Text>
                  </Text>
                  <Text style={[styles.metricLabel, { marginTop: 4 }]}>
                    Fahrenheit:{' '}
                    <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>
                      {temperatureC !== null
                        ? `${((Number(temperatureC) * 9) / 5 + 32).toFixed(1)} °F`
                        : '--'}
                    </Text>
                  </Text>
                </View>
              </View>
            </View>

            {/* CARD: HISTÓRICO DE LEITURAS */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Histórico de Leituras</Text>
              <Text style={styles.cardSubtitle}>
                Evolução recente do nível e temperatura da água
              </Text>

              {history.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Text style={styles.emptyText}>
                    Nenhum registro de histórico disponível ainda.
                  </Text>
                </View>
              ) : (
                <View style={styles.chartContainer}>
                  {history.map((point, idx) => (
                    <View key={idx} style={styles.chartCol}>
                      <Text style={styles.chartPct}>{point.level}%</Text>
                      <View style={styles.chartBarBg}>
                        <View style={[styles.chartBarFill, { height: `${point.level}%` }]} />
                      </View>
                      <Text style={styles.chartTime}>{point.time}</Text>
                      {point.temp !== null && (
                        <Text style={styles.chartTemp}>{point.temp}°C</Text>
                      )}
                    </View>
                  ))}
                </View>
              )}
            </View>

            {/* CARD: ÚLTIMAS LEITURAS */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View>
                  <Text style={styles.cardTitle}>Últimas Leituras</Text>
                  <Text style={styles.cardSubtitle}>Eventos recentes do aquário</Text>
                </View>
                <TouchableOpacity onPress={() => setActiveTab('history')}>
                  <Text style={{ color: '#7DD3FC', fontSize: 12, fontWeight: '600' }}>
                    Ver todos →
                  </Text>
                </TouchableOpacity>
              </View>

              {logs.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Text style={styles.emptyText}>Nenhuma leitura registrada ainda.</Text>
                </View>
              ) : (
                <View style={{ gap: 8 }}>
                  {logs.slice(0, 5).map((log) => (
                    <View key={log.id} style={styles.logItem}>
                      <Text style={[styles.logMsg, { flex: 1 }]}>{log.message}</Text>
                      <Text style={styles.logTime}>{log.time}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </>
        )}

        {/* ===================================================================
            ABA 2: ASSISTENTE DE CONFIGURAÇÃO INICIAL (6 PASSOS IGUAL AO SITE)
           =================================================================== */}
        {activeTab === 'setup' && (
          <View style={styles.card}>
            <View style={styles.wizardHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.wizardBadge}>SETUP WIZARD • NETUNO OS</Text>
                <Text style={styles.cardTitle}>Configuração Inicial do Aquário</Text>
                <Text style={styles.cardSubtitle}>
                  Passo {wizardStep} de 6 • Toque nas etapas abaixo para navegar
                </Text>
              </View>
              <TouchableOpacity onPress={handleSaveWizard} style={styles.saveTopBtn}>
                <Text style={styles.saveTopBtnText}>Salvar</Text>
              </TouchableOpacity>
            </View>

            {saveSuccess && (
              <View style={styles.successBanner}>
                <Text style={styles.successBannerText}>
                  ✓ Configurações salvas e aplicadas ao sistema Netuno!
                </Text>
              </View>
            )}

            {/* Seletor Horizontal das 6 Etapas */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginVertical: 10 }}
              contentContainerStyle={{ gap: 8 }}
            >
              {[
                { step: 1, label: '1. Rede Wi-Fi' },
                { step: 2, label: '2. Dimensões' },
                { step: 3, label: '3. Níveis Água' },
                { step: 4, label: '4. Temperatura' },
                { step: 5, label: '5. Display LCD' },
                { step: 6, label: '6. RTC, Bomba & Comida' },
              ].map((item) => (
                <TouchableOpacity
                  key={item.step}
                  onPress={() => setWizardStep(item.step)}
                  style={[
                    styles.stepChip,
                    wizardStep === item.step && styles.stepChipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.stepChipText,
                      wizardStep === item.step && styles.stepChipTextActive,
                    ]}
                  >
                    {item.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* PASSO 1: WI-FI E MULTI-REDE */}
            {wizardStep === 1 && (
              <View style={{ gap: 12 }}>
                <Text style={styles.sectionTitle}>
                  Painel de Configuração Wi-Fi e Múltiplas Redes (Até 5)
                </Text>
                <Text style={styles.cardSubtitle}>
                  Selecione uma rede 2.4GHz ou cadastre até 5 redes Wi-Fi para troca automática caso o sinal caia.
                </Text>

                {availableNetworks.map((net) => (
                  <TouchableOpacity
                    key={net.ssid}
                    onPress={() => setDraftConfig({ ...draftConfig, wifiSsid: net.ssid })}
                    style={[
                      styles.netItem,
                      draftConfig.wifiSsid === net.ssid && styles.netItemActive,
                    ]}
                  >
                    <View>
                      <Text style={styles.netSsid}>{net.ssid}</Text>
                      <Text style={styles.netSub}>{net.security}</Text>
                    </View>
                    <Text style={styles.netSignal}>{net.signal}</Text>
                  </TouchableOpacity>
                ))}

                <Text style={styles.inputLabel}>Nome da Rede Wi-Fi (SSID)</Text>
                <TextInput
                  style={styles.textInput}
                  value={draftConfig.wifiSsid}
                  onChangeText={(v) => setDraftConfig({ ...draftConfig, wifiSsid: v })}
                  placeholder="Nome do Wi-Fi"
                  placeholderTextColor="#64748B"
                />

                <Text style={styles.inputLabel}>Senha do Wi-Fi</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput
                    style={[styles.textInput, { flex: 1 }]}
                    secureTextEntry={!showWifiPassword}
                    value={draftConfig.wifiPassword}
                    onChangeText={(v) => setDraftConfig({ ...draftConfig, wifiPassword: v })}
                    placeholder="Senha da rede"
                    placeholderTextColor="#64748B"
                  />
                  <TouchableOpacity
                    onPress={() => setShowWifiPassword((p) => !p)}
                    style={styles.secondaryBtn}
                  >
                    <Text style={styles.secondaryBtnText}>
                      {showWifiPassword ? 'Ocultar' : 'Mostrar'}
                    </Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  onPress={() => {
                    const clean = (draftConfig.wifiSsid || '').trim();
                    if (!clean) return;
                    const list = draftConfig.savedWifiNetworks || [];
                    const exists = list.findIndex(
                      (i) => i.ssid.toLowerCase() === clean.toLowerCase()
                    );
                    let nextList;
                    if (exists >= 0) {
                      nextList = list.map((item, idx) =>
                        idx === exists
                          ? { ...item, ssid: clean, password: draftConfig.wifiPassword }
                          : item
                      );
                    } else {
                      if (list.length >= 5) return;
                      nextList = [
                        ...list,
                        { id: Date.now(), ssid: clean, password: draftConfig.wifiPassword },
                      ];
                    }
                    setDraftConfig({ ...draftConfig, savedWifiNetworks: nextList });
                  }}
                  style={styles.primaryActionBtn}
                >
                  <Text style={styles.primaryActionBtnText}>
                    + Salvar na Lista Multi-WiFi ({(draftConfig.savedWifiNetworks || []).length}/5)
                  </Text>
                </TouchableOpacity>

                <Text style={styles.inputLabel}>Redes Salvas para Troca Automática:</Text>
                {(draftConfig.savedWifiNetworks || []).map((savedNet, idx) => (
                  <View key={savedNet.id || savedNet.ssid} style={styles.savedNetRow}>
                    <Text style={styles.savedNetText}>
                      #{idx + 1} • {savedNet.ssid}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity
                        onPress={() =>
                          setDraftConfig({ ...draftConfig, wifiSsid: savedNet.ssid })
                        }
                      >
                        <Text style={{ color: '#7DD3FC', fontSize: 12, fontWeight: '700' }}>
                          Usar
                        </Text>
                      </TouchableOpacity>
                      {(draftConfig.savedWifiNetworks || []).length > 1 && (
                        <TouchableOpacity
                          onPress={() =>
                            setDraftConfig({
                              ...draftConfig,
                              savedWifiNetworks: draftConfig.savedWifiNetworks.filter(
                                (item) => item.ssid !== savedNet.ssid
                              ),
                            })
                          }
                        >
                          <Text style={{ color: '#FB7185', fontSize: 12, fontWeight: '700' }}>
                            Remover
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* PASSO 2: DIMENSÕES E LITRAGEM */}
            {wizardStep === 2 && (
              <View style={{ gap: 12 }}>
                <Text style={styles.sectionTitle}>Dimensões do Aquário e Litragem</Text>

                <Text style={styles.inputLabel}>Nome do Aquário</Text>
                <TextInput
                  style={styles.textInput}
                  value={draftConfig.aquariumName}
                  onChangeText={(v) => setDraftConfig({ ...draftConfig, aquariumName: v })}
                />

                <View style={styles.metricsRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>Comprimento (cm)</Text>
                    <TextInput
                      style={styles.textInput}
                      keyboardType="numeric"
                      value={String(draftConfig.lengthCm)}
                      onChangeText={(v) =>
                        setDraftConfig({ ...draftConfig, lengthCm: Number(v) || 0 })
                      }
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>Largura (cm)</Text>
                    <TextInput
                      style={styles.textInput}
                      keyboardType="numeric"
                      value={String(draftConfig.widthCm)}
                      onChangeText={(v) =>
                        setDraftConfig({ ...draftConfig, widthCm: Number(v) || 0 })
                      }
                    />
                  </View>
                </View>

                <View style={styles.metricsRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>Altura Total (cm)</Text>
                    <TextInput
                      style={styles.textInput}
                      keyboardType="numeric"
                      value={String(draftConfig.heightCm)}
                      onChangeText={(v) =>
                        setDraftConfig({ ...draftConfig, heightCm: Number(v) || 0 })
                      }
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>Margem Topo (mín 2cm)</Text>
                    <TextInput
                      style={styles.textInput}
                      keyboardType="numeric"
                      value={String(draftConfig.sensorOffsetCm)}
                      onChangeText={(v) =>
                        setDraftConfig({
                          ...draftConfig,
                          sensorOffsetCm: Math.max(2, Number(v) || 2),
                        })
                      }
                    />
                  </View>
                </View>

                <View style={styles.metricBox}>
                  <Text style={styles.metricLabel}>Capacidade Útil Calculada (Litragem)</Text>
                  <Text style={[styles.metricValue, { color: '#6EE7B7', fontSize: 20 }]}>
                    {maxVolumeLiters} Litros
                  </Text>
                </View>
              </View>
            )}

            {/* PASSO 3: NÍVEIS DE ÁGUA */}
            {wizardStep === 3 && (
              <View style={{ gap: 12 }}>
                <Text style={styles.sectionTitle}>Níveis de Água e Alertas (%)</Text>

                <Text style={styles.inputLabel}>
                  Nível Crítico (%): Abaixo de {draftConfig.criticalLevelPct}%
                </Text>
                <TextInput
                  style={styles.textInput}
                  keyboardType="numeric"
                  value={String(draftConfig.criticalLevelPct)}
                  onChangeText={(v) =>
                    setDraftConfig({ ...draftConfig, criticalLevelPct: Number(v) || 35 })
                  }
                />

                <Text style={styles.inputLabel}>
                  Nível de Atenção / Baixo (%): Abaixo de {draftConfig.warningLevelPct}%
                </Text>
                <TextInput
                  style={styles.textInput}
                  keyboardType="numeric"
                  value={String(draftConfig.warningLevelPct)}
                  onChangeText={(v) =>
                    setDraftConfig({ ...draftConfig, warningLevelPct: Number(v) || 65 })
                  }
                />

                <Text style={styles.inputLabel}>
                  Alerta de Muito Cheio (%): Acima de {draftConfig.maxAlertLevelPct}%
                </Text>
                <TextInput
                  style={styles.textInput}
                  keyboardType="numeric"
                  value={String(draftConfig.maxAlertLevelPct)}
                  onChangeText={(v) =>
                    setDraftConfig({ ...draftConfig, maxAlertLevelPct: Number(v) || 95 })
                  }
                />
              </View>
            )}

            {/* PASSO 4: TEMPERATURA IDEAL */}
            {wizardStep === 4 && (
              <View style={{ gap: 12 }}>
                <Text style={styles.sectionTitle}>Configuração da Temperatura Ideal (°C)</Text>

                <View style={styles.metricsRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>Mínima Ideal (°C)</Text>
                    <TextInput
                      style={styles.textInput}
                      keyboardType="numeric"
                      value={String(draftConfig.tempMinC)}
                      onChangeText={(v) =>
                        setDraftConfig({ ...draftConfig, tempMinC: Number(v) || 22 })
                      }
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>Máxima Ideal (°C)</Text>
                    <TextInput
                      style={styles.textInput}
                      keyboardType="numeric"
                      value={String(draftConfig.tempMaxC)}
                      onChangeText={(v) =>
                        setDraftConfig({ ...draftConfig, tempMaxC: Number(v) || 29 })
                      }
                    />
                  </View>
                </View>
              </View>
            )}

            {/* PASSO 5: DISPLAY LCD */}
            {wizardStep === 5 && (
              <View style={{ gap: 12 }}>
                <Text style={styles.sectionTitle}>O que será mostrado no Display LCD</Text>

                <View style={styles.lcdOuter}>
                  <View style={styles.lcdScreen}>
                    <Text style={styles.lcdText}>{lcdLine0}</Text>
                    <Text style={[styles.lcdText, { marginTop: 6 }]}>{lcdLine1}</Text>
                  </View>
                </View>

                <Text style={styles.inputLabel}>Linha 1 do Display LCD:</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {[
                    { id: 'water_pct', label: 'Nível (%)' },
                    { id: 'volume_liters', label: 'Volume (L)' },
                    { id: 'rtc_time', label: 'Hora RTC' },
                    { id: 'custom_title', label: 'Texto Fixo' },
                  ].map((opt) => (
                    <TouchableOpacity
                      key={opt.id}
                      onPress={() => setDraftConfig({ ...draftConfig, lcdLine1Mode: opt.id })}
                      style={[
                        styles.stepChip,
                        draftConfig.lcdLine1Mode === opt.id && styles.stepChipActive,
                      ]}
                    >
                      <Text style={styles.stepChipText}>{opt.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.inputLabel}>Linha 2 do Display LCD:</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {[
                    { id: 'temp_c', label: 'Temperatura' },
                    { id: 'rtc_time', label: 'Hora RTC' },
                    { id: 'pump_status', label: 'Bomba Oxigênio' },
                    { id: 'next_feed', label: 'Próx. Comida' },
                  ].map((opt) => (
                    <TouchableOpacity
                      key={opt.id}
                      onPress={() => setDraftConfig({ ...draftConfig, lcdLine2Mode: opt.id })}
                      style={[
                        styles.stepChip,
                        draftConfig.lcdLine2Mode === opt.id && styles.stepChipActive,
                      ]}
                    >
                      <Text style={styles.stepChipText}>{opt.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {/* PASSO 6: MÓDULO RTC, BOMBA DE OXIGÊNIO E ALIMENTADOR */}
            {wizardStep === 6 && (
              <View style={{ gap: 14 }}>
                <Text style={styles.sectionTitle}>
                  Configuração do Horário do Módulo RTC
                </Text>
                <Text style={styles.cardSubtitle}>
                  Horário atual no RTC: {rtcTimeFormatted} • {rtcDateFormatted}
                </Text>

                <View style={styles.metricsRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>Data (AAAA-MM-DD)</Text>
                    <TextInput
                      style={styles.textInput}
                      value={rtcEditDate}
                      onChangeText={setRtcEditDate}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>Hora (HH:MM:SS)</Text>
                    <TextInput
                      style={styles.textInput}
                      value={rtcEditTime}
                      onChangeText={setRtcEditTime}
                    />
                  </View>
                </View>

                <View style={styles.metricsRow}>
                  <TouchableOpacity
                    onPress={() => handleApplyRtcFromApp(null)}
                    style={[styles.primaryActionBtn, { flex: 1 }]}
                  >
                    <Text style={styles.primaryActionBtnText}>Gravar Horário no RTC</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleApplyRtcFromApp(new Date().toISOString())}
                    style={[styles.secondaryBtn, { flex: 1, alignItems: 'center' }]}
                  >
                    <Text style={styles.secondaryBtnText}>Usar Hora Atual</Text>
                  </TouchableOpacity>
                </View>

                {rtcSaveNotice && (
                  <Text style={{ color: '#6EE7B7', fontSize: 12, fontWeight: '700' }}>
                    ✓ Horário gravado no módulo RTC com sucesso!
                  </Text>
                )}

                {/* Bomba de Oxigênio */}
                <View style={styles.divider} />
                <Text style={styles.sectionTitle}>
                  Bomba de Oxigênio ({pumpRelayOn ? 'Aberta' : 'Fechada'})
                </Text>
                <TouchableOpacity onPress={togglePump} style={styles.primaryActionBtn}>
                  <Text style={styles.primaryActionBtnText}>
                    {pumpRelayOn ? 'Bomba Aberta (Toque p/ Fechar)' : 'Bomba Fechada (Toque p/ Abrir)'}
                  </Text>
                </TouchableOpacity>

                {/* Alimentador Baseado no RTC */}
                <View style={styles.divider} />
                <Text style={styles.sectionTitle}>
                  Alimentador (Baseado no Horário do Módulo RTC)
                </Text>
                <TouchableOpacity
                  onPress={() => feedNow(draftConfig.defaultPortion)}
                  style={styles.primaryActionBtn}
                >
                  <Text style={styles.primaryActionBtnText}>
                    {isFeeding
                      ? 'Dispensando Ração...'
                      : `Alimentar Agora (${draftConfig.defaultPortion})`}
                  </Text>
                </TouchableOpacity>

                <View style={styles.metricsRow}>
                  <TextInput
                    style={[styles.textInput, { flex: 1 }]}
                    value={newScheduleTime}
                    onChangeText={setNewScheduleTime}
                    placeholder="08:00"
                    placeholderTextColor="#64748B"
                  />
                  <TouchableOpacity
                    onPress={() => addSchedule(newScheduleTime, newSchedulePortion)}
                    style={styles.secondaryBtn}
                  >
                    <Text style={styles.secondaryBtnText}>+ Adicionar Horário</Text>
                  </TouchableOpacity>
                </View>

                {schedules.map((item) => (
                  <View key={item.id} style={styles.savedNetRow}>
                    <Text style={styles.savedNetText}>
                      {item.time} • {item.portion} ({item.enabled ? 'Ativo' : 'Pausado'})
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <TouchableOpacity onPress={() => toggleSchedule(item.id)}>
                        <Text style={{ color: '#7DD3FC', fontSize: 12, fontWeight: '700' }}>
                          {item.enabled ? 'Pausar' : 'Ativar'}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => deleteSchedule(item.id)}>
                        <Text style={{ color: '#FB7185', fontSize: 12, fontWeight: '700' }}>
                          Excluir
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Navegação Entre Passos */}
            <View style={[styles.metricsRow, { marginTop: 16 }]}>
              <TouchableOpacity
                disabled={wizardStep === 1}
                onPress={() => setWizardStep((s) => Math.max(1, s - 1))}
                style={[styles.secondaryBtn, { opacity: wizardStep === 1 ? 0.4 : 1 }]}
              >
                <Text style={styles.secondaryBtnText}>← Anterior</Text>
              </TouchableOpacity>

              {wizardStep < 6 ? (
                <TouchableOpacity
                  onPress={() => setWizardStep((s) => Math.min(6, s + 1))}
                  style={[styles.primaryActionBtn, { flex: 1 }]}
                >
                  <Text style={styles.primaryActionBtnText}>Próximo Passo →</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={handleSaveWizard}
                  style={[styles.primaryActionBtn, { flex: 1 }]}
                >
                  <Text style={styles.primaryActionBtnText}>Concluir e Salvar</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* ===================================================================
            ABA 3: HISTÓRICO DE EVENTOS
           =================================================================== */}
        {!exclusiveSetupMode && activeTab === 'history' && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>Histórico de Eventos</Text>
                <Text style={styles.cardSubtitle}>
                  Registro completo das leituras do aquário.
                </Text>
              </View>
              <TouchableOpacity onPress={fetchFromSupabase} style={styles.refreshBtn}>
                <Text style={styles.refreshBtnText}>Atualizar Agora</Text>
              </TouchableOpacity>
            </View>

            {logs.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>Nenhum registro encontrado no histórico.</Text>
              </View>
            ) : (
              <View style={{ gap: 10 }}>
                {logs.map((log) => (
                  <View key={log.id} style={styles.logItem}>
                    <Text style={[styles.logMsg, { flex: 1 }]}>{log.message}</Text>
                    <Text style={styles.logTime}>{log.time}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* BARRA DE NAVEGAÇÃO INFERIOR NATIVA DO APP (Oculta se estiver em Modo Exclusivo de Setup) */}
      {!exclusiveSetupMode && (
        <View style={styles.bottomNav}>
          {[
            { id: 'dashboard', label: 'Painel Principal' },
            { id: 'setup', label: 'Configuração' },
            { id: 'history', label: 'Histórico' },
          ].map((tab) => {
            const active = activeTab === tab.id;
            return (
              <TouchableOpacity
                key={tab.id}
                onPress={() => {
                  if (tab.id === 'setup') setDraftConfig(config);
                  setActiveTab(tab.id);
                }}
                style={[styles.navItem, active && styles.navItemActive]}
              >
                <Text style={[styles.navText, active && styles.navTextActive]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#06101E',
    paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight : 0,
  },
  criticalBanner: {
    backgroundColor: '#E11D48',
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  criticalBannerText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(26, 83, 155, 0.45)',
    backgroundColor: '#081528',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  clockTimeText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  clockDateText: {
    color: '#7DD3FC',
    fontSize: 10,
  },
  setupHeaderBtn: {
    backgroundColor: '#1A539B',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(125,211,252,0.4)',
  },
  setupHeaderBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  backHeaderBtn: {
    backgroundColor: '#0F2747',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(125,211,252,0.35)',
  },
  backHeaderBtnText: {
    color: '#BAE6FD',
    fontSize: 11,
    fontWeight: '700',
  },
  logo: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  brandTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 2,
  },
  brandSub: {
    color: '#7DD3FC',
    fontSize: 10,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
    gap: 16,
  },
  summaryContainer: {
    backgroundColor: '#12396B',
    borderRadius: 20,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(125,211,252,0.25)',
    gap: 10,
  },
  kpiGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  kpiCard: {
    flex: 1,
    backgroundColor: 'rgba(8, 23, 46, 0.7)',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  kpiLabel: {
    color: '#BAE6FD',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  kpiValue: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    marginTop: 4,
  },
  kpiSub: {
    color: '#7DD3FC',
    fontSize: 11,
    marginTop: 2,
  },
  card: {
    backgroundColor: '#0B1D35',
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(26, 83, 155, 0.55)',
    gap: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  cardSubtitle: {
    color: '#93C5FD',
    fontSize: 11,
    marginTop: 2,
  },
  statePill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  statePillText: {
    fontSize: 10,
    fontWeight: '700',
  },
  tankContainer: {
    height: 170,
    borderRadius: 16,
    backgroundColor: '#06101E',
    borderWidth: 1.5,
    borderColor: '#1A539B',
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  waterFill: {
    width: '100%',
    backgroundColor: '#1A539B',
    borderTopWidth: 2,
    borderTopColor: '#38BDF8',
  },
  tankCenterOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tankBigPct: {
    color: '#FFFFFF',
    fontSize: 36,
    fontWeight: '900',
  },
  tankVolumeText: {
    color: '#E0F2FE',
    fontSize: 11,
    fontWeight: '600',
    backgroundColor: 'rgba(6, 16, 30, 0.7)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    marginTop: 4,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  metricBox: {
    flex: 1,
    backgroundColor: '#06101E',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(26, 83, 155, 0.45)',
    alignItems: 'center',
  },
  metricLabel: {
    color: '#93C5FD',
    fontSize: 11,
  },
  metricValue: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    marginTop: 2,
  },
  lcdOuter: {
    backgroundColor: '#050D1A',
    borderRadius: 14,
    padding: 10,
    borderWidth: 1.5,
    borderColor: '#1A539B',
  },
  lcdScreen: {
    backgroundColor: '#0B3529',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(52, 211, 153, 0.45)',
  },
  lcdText: {
    color: '#A7F3D0',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 2,
  },
  tempBox: {
    backgroundColor: '#06101E',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(26, 83, 155, 0.45)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tempBigValue: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '900',
    marginTop: 4,
  },
  emptyBox: {
    backgroundColor: '#06101E',
    borderRadius: 14,
    padding: 22,
    alignItems: 'center',
  },
  emptyText: {
    color: '#93C5FD',
    fontSize: 12,
    textAlign: 'center',
  },
  chartContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 150,
    paddingTop: 12,
    gap: 6,
  },
  chartCol: {
    flex: 1,
    alignItems: 'center',
  },
  chartPct: {
    color: '#BAE6FD',
    fontSize: 10,
    marginBottom: 4,
  },
  chartBarBg: {
    width: 24,
    height: 90,
    backgroundColor: '#06101E',
    borderRadius: 8,
    justifyContent: 'flex-end',
    padding: 2,
    borderWidth: 1,
    borderColor: 'rgba(26, 83, 155, 0.4)',
  },
  chartBarFill: {
    width: '100%',
    backgroundColor: '#38BDF8',
    borderRadius: 5,
  },
  chartTime: {
    color: '#93C5FD',
    fontSize: 10,
    marginTop: 4,
  },
  chartTemp: {
    color: '#6EE7B7',
    fontSize: 9,
  },
  logItem: {
    backgroundColor: '#06101E',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(26, 83, 155, 0.4)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  logMsg: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  logTime: {
    color: '#7DD3FC',
    fontSize: 11,
  },
  refreshBtn: {
    backgroundColor: '#1A539B',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  refreshBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  wizardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  wizardBadge: {
    color: '#7DD3FC',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  saveTopBtn: {
    backgroundColor: '#10B981',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  saveTopBtnText: {
    color: '#052E16',
    fontSize: 12,
    fontWeight: '800',
  },
  successBanner: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.4)',
  },
  successBannerText: {
    color: '#6EE7B7',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  stepChip: {
    backgroundColor: '#06101E',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(26, 83, 155, 0.5)',
  },
  stepChipActive: {
    backgroundColor: '#1A539B',
    borderColor: '#7DD3FC',
  },
  stepChipText: {
    color: '#BAE6FD',
    fontSize: 11,
    fontWeight: '700',
  },
  stepChipTextActive: {
    color: '#FFFFFF',
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  inputLabel: {
    color: '#BAE6FD',
    fontSize: 11,
    fontWeight: '600',
  },
  textInput: {
    backgroundColor: '#06101E',
    borderWidth: 1,
    borderColor: 'rgba(26, 83, 155, 0.7)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    color: '#FFFFFF',
    fontSize: 13,
  },
  netItem: {
    backgroundColor: '#06101E',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(26, 83, 155, 0.45)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  netItemActive: {
    backgroundColor: 'rgba(26, 83, 155, 0.65)',
    borderColor: '#7DD3FC',
  },
  netSsid: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  netSub: {
    color: '#93C5FD',
    fontSize: 10,
  },
  netSignal: {
    color: '#6EE7B7',
    fontSize: 11,
    fontWeight: '700',
  },
  primaryActionBtn: {
    backgroundColor: '#10B981',
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionBtnText: {
    color: '#052E16',
    fontSize: 12,
    fontWeight: '800',
  },
  secondaryBtn: {
    backgroundColor: '#1A539B',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    justifyContent: 'center',
  },
  secondaryBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  savedNetRow: {
    backgroundColor: '#06101E',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(26, 83, 155, 0.45)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  savedNetText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(26, 83, 155, 0.45)',
    marginVertical: 4,
  },
  bottomNav: {
    flexDirection: 'row',
    backgroundColor: '#081528',
    borderTopWidth: 1,
    borderTopColor: 'rgba(26, 83, 155, 0.45)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  navItem: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  navItemActive: {
    backgroundColor: '#1A539B',
  },
  navText: {
    color: '#93C5FD',
    fontSize: 12,
    fontWeight: '700',
  },
  navTextActive: {
    color: '#FFFFFF',
  },
});
