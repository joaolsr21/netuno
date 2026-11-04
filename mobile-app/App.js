import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Image,
  SafeAreaView,
  Switch,
  TextInput,
  Platform,
  StatusBar as RNStatusBar,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useAquariumConnection } from './src/hooks/useAquariumConnection';

export default function App() {
  const {
    transport,
    wifiAvailable,
    bleStatusText,
    waterLevelPct,
    distanceCm,
    pumpRelayOn,
    pumpMode,
    isFeeding,
    schedules,
    logs,
    pendingPhoneSync,
    togglePump,
    changePumpMode,
    feedNow,
    connectBluetooth,
    simulateWifiDropOrRestore,
    addSchedule,
    toggleSchedule,
    deleteSchedule,
    updateSimulatedWaterLevel,
  } = useAquariumConnection();

  const [activeTab, setActiveTab] = useState('painel'); // 'painel' | 'agenda' | 'conexao'
  const [selectedPortion, setSelectedPortion] = useState('Padrão (5g)');
  const [newTime, setNewTime] = useState('18:00');

  const isCritical = waterLevelPct < 40;
  const isLow = waterLevelPct >= 40 && waterLevelPct < 65;

  const handleCreateSchedule = () => {
    if (!newTime.trim()) return;
    addSchedule(newTime.trim(), selectedPortion);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" backgroundColor="#06101E" />

      {/* ALERTA DE NÍVEL CRÍTICO */}
      {isCritical && (
        <View style={styles.criticalBanner}>
          <Text style={styles.criticalBannerText}>
            ⚠️ NÍVEL CRÍTICO ({waterLevelPct}% / {distanceCm} cm) — Verifique o aquário!
          </Text>
        </View>
      )}

      {/* CABEÇALHO DO APP ANDROID */}
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <Image source={require('./assets/logo-netuno.jpg')} style={styles.logo} />
          <Text style={styles.brandTitle}>NETUNO</Text>
        </View>

        {/* Pílula do Canal de Comunicação Ativo (Wi-Fi vs Bluetooth) */}
        <TouchableOpacity
          onPress={simulateWifiDropOrRestore}
          activeOpacity={0.8}
          style={[
            styles.transportBadge,
            transport === 'wifi' ? styles.transportWifi : styles.transportBle,
          ]}
        >
          <View
            style={[
              styles.statusDot,
              { backgroundColor: transport === 'wifi' ? '#34D399' : '#38BDF8' },
            ]}
          />
          <View>
            <Text style={styles.transportTitle}>
              {transport === 'wifi' ? 'Wi-Fi • Nuvem' : 'Bluetooth • BLE'}
            </Text>
            <Text style={styles.transportSub}>
              {transport === 'wifi' ? 'Supabase Ativo' : 'Direto no ESP32'}
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* CONTEÚDO ROLÁVEL */}
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {activeTab === 'painel' && (
          <>
            {/* RESUMO RÁPIDO EM 2 COLUNAS */}
            <View style={styles.kpiGrid}>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>NÍVEL D'ÁGUA</Text>
                <Text style={styles.kpiValue}>{waterLevelPct}%</Text>
                <Text style={styles.kpiSub}>{distanceCm} cm do sensor</Text>
              </View>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>OXIGENAÇÃO</Text>
                <Text
                  style={[
                    styles.kpiValue,
                    { color: pumpRelayOn ? '#6EE7B7' : '#FCD34D' },
                  ]}
                >
                  {pumpRelayOn ? 'Ativa' : 'Pausada'}
                </Text>
                <Text style={styles.kpiSub}>
                  Modo: {pumpMode === 'auto' ? 'Automático' : 'Manual'}
                </Text>
              </View>
            </View>

            {/* CARD 1: TANQUE & SENSOR ULTRASSÔNICO */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View>
                  <Text style={styles.cardTitle}>Nível da Água</Text>
                  <Text style={styles.cardSubtitle}>Sensor Ultrassônico HC-SR04</Text>
                </View>
                <View
                  style={[
                    styles.statePill,
                    isCritical
                      ? styles.pillCritical
                      : isLow
                      ? styles.pillWarning
                      : styles.pillIdeal,
                  ]}
                >
                  <Text style={styles.statePillText}>
                    {isCritical ? 'Crítico' : isLow ? 'Atenção' : 'Ideal'}
                  </Text>
                </View>
              </View>

              {/* Visualização do Tanque */}
              <View style={styles.tankContainer}>
                <View style={styles.sensorTopTag}>
                  <Text style={styles.sensorTopTagText}>
                    HC-SR04 • {distanceCm} cm até a água
                  </Text>
                </View>

                <View style={[styles.waterFill, { height: `${waterLevelPct}%` }]} />

                <View style={styles.tankCenterOverlay}>
                  <Text style={styles.tankBigPct}>{waterLevelPct}%</Text>
                  <Text style={styles.tankVolumeText}>
                    ~{Math.round((waterLevelPct / 100) * 120)} Litros
                  </Text>
                </View>
              </View>

              {/* Botões rápidos para testar simulação de nível na base */}
              <View style={styles.simRow}>
                <Text style={styles.simLabel}>Testar leitura do sensor:</Text>
                <View style={styles.simButtons}>
                  <TouchableOpacity
                    style={styles.simBtn}
                    onPress={() => updateSimulatedWaterLevel(waterLevelPct - 10)}
                  >
                    <Text style={styles.simBtnText}>-10%</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.simBtn}
                    onPress={() => updateSimulatedWaterLevel(85)}
                  >
                    <Text style={styles.simBtnText}>85%</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.simBtn}
                    onPress={() => updateSimulatedWaterLevel(waterLevelPct + 10)}
                  >
                    <Text style={styles.simBtnText}>+10%</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            {/* CARD 2: BOMBA DE OXIGÊNIO (RELÉ) */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View>
                  <Text style={styles.cardTitle}>Bomba de Oxigênio</Text>
                  <Text style={styles.cardSubtitle}>
                    Módulo Relé GPIO 26 • Via {transport === 'wifi' ? 'Wi-Fi' : 'Bluetooth'}
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                onPress={togglePump}
                activeOpacity={0.85}
                style={[
                  styles.primaryActionBtn,
                  pumpRelayOn ? styles.btnRelayOn : styles.btnCobalt,
                ]}
              >
                <Text
                  style={[
                    styles.primaryActionText,
                    pumpRelayOn && { color: '#042F2E' },
                  ]}
                >
                  {pumpRelayOn ? '⚡ Relé Ligado (Toque p/ Desligar)' : 'Ligar Bomba de Oxigênio'}
                </Text>
              </TouchableOpacity>

              <View style={styles.segmentContainer}>
                <TouchableOpacity
                  onPress={() => changePumpMode('auto')}
                  style={[
                    styles.segmentBtn,
                    pumpMode === 'auto' && styles.segmentBtnActive,
                  ]}
                >
                  <Text style={styles.segmentText}>Ciclo Automático</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => changePumpMode('manual')}
                  style={[
                    styles.segmentBtn,
                    pumpMode === 'manual' && styles.segmentBtnActive,
                  ]}
                >
                  <Text style={styles.segmentText}>Manual Fixo</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* CARD 3: ALIMENTADOR AUTOMÁTICO */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View>
                  <Text style={styles.cardTitle}>Alimentador Automático</Text>
                  <Text style={styles.cardSubtitle}>
                    Servo Motor GPIO 14 • Selecione a porção
                  </Text>
                </View>
              </View>

              <View style={styles.portionRow}>
                {['Leve (3g)', 'Padrão (5g)', 'Generosa (8g)'].map((portion) => {
                  const selected = selectedPortion === portion;
                  return (
                    <TouchableOpacity
                      key={portion}
                      onPress={() => setSelectedPortion(portion)}
                      style={[
                        styles.portionChip,
                        selected && styles.portionChipSelected,
                      ]}
                    >
                      <Text
                        style={[
                          styles.portionChipText,
                          selected && { color: '#FFFFFF', fontWeight: '700' },
                        ]}
                      >
                        {portion}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TouchableOpacity
                onPress={() => feedNow(selectedPortion)}
                disabled={isFeeding}
                activeOpacity={0.85}
                style={[
                  styles.primaryActionBtn,
                  isFeeding ? styles.btnFeeding : styles.btnCobalt,
                ]}
              >
                <Text
                  style={[
                    styles.primaryActionText,
                    isFeeding && { color: '#1E293B' },
                  ]}
                >
                  {isFeeding
                    ? '🐟 Dispensando Ração...'
                    : `Alimentar Agora (${selectedPortion})`}
                </Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* ABA 2: AGENDA DO ALIMENTADOR */}
        {activeTab === 'agenda' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Horários do Alimentador</Text>
            <Text style={styles.cardSubtitle}>
              Sincronizados com o ESP32 e a tabela feed_schedules
            </Text>

            <View style={{ marginTop: 16, gap: 10 }}>
              {schedules.map((item) => (
                <View key={item.id} style={styles.scheduleItem}>
                  <View>
                    <Text style={styles.scheduleTime}>{item.time}</Text>
                    <Text style={styles.schedulePortion}>
                      {item.portion} • {item.label}
                    </Text>
                  </View>
                  <View style={styles.scheduleActions}>
                    <Switch
                      value={item.enabled}
                      onValueChange={() => toggleSchedule(item.id)}
                      trackColor={{ false: '#1E293B', true: '#10B981' }}
                      thumbColor="#FFFFFF"
                    />
                    <TouchableOpacity
                      onPress={() => deleteSchedule(item.id)}
                      style={styles.deleteBtn}
                    >
                      <Text style={styles.deleteBtnText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>

            <View style={styles.addScheduleBox}>
              <Text style={styles.simLabel}>Novo horário (HH:MM):</Text>
              <View style={styles.addScheduleRow}>
                <TextInput
                  value={newTime}
                  onChangeText={setNewTime}
                  placeholder="18:00"
                  placeholderTextColor="#64748B"
                  style={styles.timeInput}
                />
                <TouchableOpacity onPress={handleCreateSchedule} style={styles.addBtn}>
                  <Text style={styles.addBtnText}>+ Agendar</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* ABA 3: CONEXÃO HÍBRIDA (WI-FI <-> BLUETOOTH) & LOGS */}
        {activeTab === 'conexao' && (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Arquitetura Híbrida do .APK</Text>
              <Text style={styles.cardSubtitle}>
                Wi-Fi (Supabase) quando online • Bluetooth (BLE) quando a internet cai
              </Text>

              <View style={styles.connectionInfoBox}>
                <Text style={styles.connLine}>
                  • Canal Atual:{' '}
                  <Text style={{ color: '#38BDF8', fontWeight: '700' }}>
                    {transport === 'wifi' ? 'Wi-Fi -> Supabase' : 'Bluetooth BLE -> ESP32'}
                  </Text>
                </Text>
                <Text style={styles.connLine}>
                  • Status Bluetooth: <Text style={{ color: '#E2E8F0' }}>{bleStatusText}</Text>
                </Text>
                <Text style={styles.connLine}>
                  • Registros Offline no Celular:{' '}
                  <Text style={{ color: '#34D399', fontWeight: '700' }}>
                    {pendingPhoneSync.length} pendente(s)
                  </Text>
                </Text>
              </View>

              <View style={{ gap: 10, marginTop: 14 }}>
                <TouchableOpacity
                  onPress={simulateWifiDropOrRestore}
                  style={[styles.primaryActionBtn, styles.btnCobalt]}
                >
                  <Text style={styles.primaryActionText}>
                    {wifiAvailable
                      ? 'Simular Queda do Wi-Fi (Ativar Bluetooth)'
                      : 'Simular Volta do Wi-Fi (Voltar p/ Supabase)'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={connectBluetooth}
                  style={styles.secondaryActionBtn}
                >
                  <Text style={styles.secondaryActionText}>
                    Forçar Busca Bluetooth (NETUNO_ESP32)
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Últimos Eventos</Text>
              <View style={{ marginTop: 12, gap: 8 }}>
                {logs.map((log) => (
                  <View key={log.id} style={styles.logItem}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.logMsg}>{log.message}</Text>
                      <Text style={styles.logSource}>{log.source}</Text>
                    </View>
                    <Text style={styles.logTime}>{log.time}</Text>
                  </View>
                ))}
              </View>
            </View>
          </>
        )}
      </ScrollView>

      {/* BARRA DE NAVEGAÇÃO INFERIOR NATIVA DO APP */}
      <View style={styles.bottomNav}>
        {[
          { id: 'painel', label: 'Painel' },
          { id: 'agenda', label: 'Alimentador' },
          { id: 'conexao', label: 'Wi-Fi / BLE' },
        ].map((tab) => {
          const active = activeTab === tab.id;
          return (
            <TouchableOpacity
              key={tab.id}
              onPress={() => setActiveTab(tab.id)}
              style={[styles.navItem, active && styles.navItemActive]}
            >
              <Text style={[styles.navText, active && styles.navTextActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
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
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(26, 83, 155, 0.45)',
    backgroundColor: '#081528',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logo: {
    width: 42,
    height: 42,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  brandTitle: {
    color: '#FFFFFF',
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: 3,
  },
  transportBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    borderWidth: 1,
  },
  transportWifi: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderColor: 'rgba(52, 211, 153, 0.4)',
  },
  transportBle: {
    backgroundColor: 'rgba(56, 189, 248, 0.16)',
    borderColor: 'rgba(56, 189, 248, 0.5)',
  },
  statusDot: {
    width: 9,
    height: 9,
    borderRadius: 99,
  },
  transportTitle: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  transportSub: {
    color: '#BAE6FD',
    fontSize: 10,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
    gap: 16,
  },
  kpiGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  kpiCard: {
    flex: 1,
    backgroundColor: '#12386B',
    borderRadius: 20,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(125, 211, 252, 0.25)',
  },
  kpiLabel: {
    color: '#BAE6FD',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  kpiValue: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
    marginTop: 2,
  },
  kpiSub: {
    color: '#7DD3FC',
    fontSize: 11,
    marginTop: 2,
  },
  card: {
    backgroundColor: '#0B1D35',
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(26, 83, 155, 0.6)',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  cardSubtitle: {
    color: '#93C5FD',
    fontSize: 12,
    marginTop: 2,
  },
  statePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 99,
  },
  pillIdeal: {
    backgroundColor: 'rgba(56, 189, 248, 0.18)',
  },
  pillWarning: {
    backgroundColor: 'rgba(251, 191, 36, 0.2)',
  },
  pillCritical: {
    backgroundColor: 'rgba(244, 63, 94, 0.25)',
  },
  statePillText: {
    color: '#E0F2FE',
    fontSize: 11,
    fontWeight: '700',
  },
  tankContainer: {
    height: 190,
    backgroundColor: '#06101E',
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#1A539B',
    overflow: 'hidden',
    justifyContent: 'flex-end',
    position: 'relative',
  },
  sensorTopTag: {
    position: 'absolute',
    top: 0,
    alignSelf: 'center',
    zIndex: 10,
    backgroundColor: '#1A539B',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
  },
  sensorTopTagText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  waterFill: {
    width: '100%',
    backgroundColor: '#1A539B',
    borderTopWidth: 3,
    borderTopColor: '#38BDF8',
  },
  tankCenterOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  tankBigPct: {
    color: '#FFFFFF',
    fontSize: 40,
    fontWeight: '800',
  },
  tankVolumeText: {
    color: '#E0F2FE',
    fontSize: 12,
    backgroundColor: 'rgba(6, 16, 30, 0.65)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 99,
    marginTop: 4,
  },
  simRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  simLabel: {
    color: '#BAE6FD',
    fontSize: 12,
    fontWeight: '600',
  },
  simButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  simBtn: {
    backgroundColor: '#06101E',
    borderWidth: 1,
    borderColor: '#1A539B',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  simBtnText: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '700',
  },
  primaryActionBtn: {
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnCobalt: {
    backgroundColor: '#1A539B',
    borderWidth: 1,
    borderColor: 'rgba(125, 211, 252, 0.35)',
  },
  btnRelayOn: {
    backgroundColor: '#10B981',
  },
  btnFeeding: {
    backgroundColor: '#FBBF24',
  },
  primaryActionText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryActionBtn: {
    paddingVertical: 12,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#38BDF8',
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
  },
  secondaryActionText: {
    color: '#38BDF8',
    fontSize: 13,
    fontWeight: '700',
  },
  segmentContainer: {
    flexDirection: 'row',
    backgroundColor: '#06101E',
    padding: 4,
    borderRadius: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: 'rgba(26, 83, 155, 0.45)',
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    borderRadius: 10,
  },
  segmentBtnActive: {
    backgroundColor: '#1A539B',
  },
  segmentText: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '600',
  },
  portionRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  portionChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#06101E',
    borderWidth: 1,
    borderColor: 'rgba(26, 83, 155, 0.5)',
    alignItems: 'center',
  },
  portionChipSelected: {
    backgroundColor: '#1A539B',
    borderColor: '#38BDF8',
  },
  portionChipText: {
    color: '#93C5FD',
    fontSize: 11,
    fontWeight: '600',
  },
  scheduleItem: {
    backgroundColor: '#06101E',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(26, 83, 155, 0.45)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  scheduleTime: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
  },
  schedulePortion: {
    color: '#93C5FD',
    fontSize: 12,
    marginTop: 2,
  },
  scheduleActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  deleteBtn: {
    padding: 6,
  },
  deleteBtnText: {
    color: '#FB7185',
    fontSize: 15,
    fontWeight: '700',
  },
  addScheduleBox: {
    marginTop: 18,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(26, 83, 155, 0.35)',
    gap: 8,
  },
  addScheduleRow: {
    flexDirection: 'row',
    gap: 10,
  },
  timeInput: {
    flex: 1,
    backgroundColor: '#06101E',
    borderWidth: 1,
    borderColor: '#1A539B',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#FFFFFF',
    fontSize: 14,
  },
  addBtn: {
    backgroundColor: '#1A539B',
    paddingHorizontal: 18,
    borderRadius: 12,
    justifyContent: 'center',
  },
  addBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  connectionInfoBox: {
    backgroundColor: '#06101E',
    borderRadius: 16,
    padding: 14,
    marginTop: 14,
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(26, 83, 155, 0.45)',
  },
  connLine: {
    color: '#93C5FD',
    fontSize: 12,
  },
  logItem: {
    backgroundColor: '#06101E',
    borderRadius: 14,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: 'rgba(26, 83, 155, 0.35)',
  },
  logMsg: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  logSource: {
    color: '#7DD3FC',
    fontSize: 10,
    marginTop: 2,
  },
  logTime: {
    color: '#BAE6FD',
    fontSize: 11,
    fontWeight: '700',
    marginLeft: 8,
  },
  bottomNav: {
    flexDirection: 'row',
    backgroundColor: '#081528',
    borderTopWidth: 1,
    borderTopColor: 'rgba(26, 83, 155, 0.45)',
    paddingHorizontal: 12,
    paddingVertical: 10,
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
    fontWeight: '600',
  },
  navTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
