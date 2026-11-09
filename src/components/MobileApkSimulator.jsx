import React, { useState } from 'react';
import {
  Wifi,
  Bluetooth,
  Waves,
  Wind,
  Utensils,
  Power,
  Plus,
  Trash2,
  RefreshCw,
  Smartphone,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';

export default function MobileApkSimulator({
  waterLevelPct,
  setWaterLevelPct,
  ultrasonicDistanceCm,
  pumpActive,
  onTogglePump,
  pumpMode,
  setPumpMode,
  isFeeding,
  onFeedNow,
  schedules,
  onToggleSchedule,
  onDeleteSchedule,
  onAddSchedule,
  logs,
  espOnline,
  setEspOnline,
}) {
  const [mobileTab, setMobileTab] = useState('painel'); // 'painel' | 'agenda' | 'conexao'
  const [selectedPortion, setSelectedPortion] = useState('Padrão (5g)');
  const [newTime, setNewTime] = useState('18:00');
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);
  const [syncedFromBle, setSyncedFromBle] = useState(false);

  // Se o Wi-Fi do ESP32 estiver online -> usa Wi-Fi (Supabase). Se cair -> chaveia para Bluetooth BLE!
  const transport = espOnline ? 'wifi' : 'bluetooth';
  const isCritical = waterLevelPct < 40;
  const isLow = waterLevelPct >= 40 && waterLevelPct < 65;

  const handleSimulateWifiDrop = () => {
    if (espOnline) {
      setEspOnline(false);
      setOfflineQueueCount(3);
      setSyncedFromBle(false);
    } else {
      setEspOnline(true);
      setOfflineQueueCount(0);
    }
  };

  const handleRescueOfflineViaBle = () => {
    setOfflineQueueCount(0);
    setSyncedFromBle(true);
  };

  return (
    <div className="flex flex-col lg:flex-row items-center lg:items-start justify-center gap-8 py-2">
      {/* COLUNA ESQUERDA: APARELHO ANDROID VIRTUAL INTERATIVO */}
      <div className="relative w-[360px] sm:w-[380px] h-[740px] rounded-[46px] bg-[#030914] p-3 border-[4px] border-[#1A539B]/70 shadow-2xl shadow-black flex flex-col select-none shrink-0">
        {/* Câmera frontal (Punch-hole Android) */}
        <div className="absolute top-5 left-1/2 -translate-x-1/2 z-30 w-24 h-5 bg-black rounded-full border border-white/10 flex items-center justify-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[#0F2747] border border-sky-400/40"></span>
          <span className="w-8 h-1 rounded-full bg-slate-800"></span>
        </div>

        {/* TELA INTERNA DO ANDROID */}
        <div className="flex-1 rounded-[36px] bg-[#06101E] overflow-hidden flex flex-col border border-white/10">
          {/* Barra de Status do Android */}
          <div className="pt-2 pb-1.5 px-6 flex items-center justify-between text-[11px] font-mono-code text-sky-200/80 bg-[#081528]">
            <span>09:41</span>
            <div className="flex items-center gap-1.5">
              <Bluetooth className={`w-3 h-3 ${transport === 'bluetooth' ? 'text-sky-400 animate-pulse' : 'text-slate-500'}`} />
              <Wifi className={`w-3 h-3 ${transport === 'wifi' ? 'text-emerald-400' : 'text-slate-600'}`} />
              <span>5G</span>
              <span className="px-1 py-0.2 bg-emerald-500/30 text-emerald-300 rounded text-[9px]">98%</span>
            </div>
          </div>

          {/* Alerta Crítico no topo do App */}
          {isCritical && (
            <div className="bg-rose-600 px-3 py-1.5 text-center text-[11px] font-bold text-white flex items-center justify-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>NÍVEL CRÍTICO ({waterLevelPct}%)</span>
            </div>
          )}

          {/* Header do App Mobile */}
          <div className="px-4 py-3 bg-[#081528] border-b border-[#1A539B]/40 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <img
                src="/logo-netuno.jpg"
                alt="Netuno"
                className="w-9 h-9 rounded-xl object-cover border border-white/25"
              />
              <span className="font-serif text-lg font-extrabold tracking-widest text-white">
                NETUNO
              </span>
            </div>
          </div>

          {/* Conteúdo Rolável do App Android */}
          <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5">
            {mobileTab === 'painel' && (
              <>
                {/* 2 Mini KPIs */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="bg-[#12386B] border border-sky-300/25 rounded-2xl p-3">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-sky-200 block">
                      NÍVEL D'ÁGUA
                    </span>
                    <span className="text-2xl font-extrabold text-white mt-0.5 block">
                      {waterLevelPct}%
                    </span>
                    <span className="text-[10px] text-sky-300">
                      {isCritical ? 'Crítico' : isLow ? 'Atenção' : 'Estável'}
                    </span>
                  </div>

                  <div className="bg-[#12386B] border border-sky-300/25 rounded-2xl p-3">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-sky-200 block">
                      BOMBA DE OXIGÊNIO
                    </span>
                    <span
                      className={`text-2xl font-extrabold mt-0.5 block ${
                        pumpActive ? 'text-emerald-300' : 'text-amber-300'
                      }`}
                    >
                      {pumpActive ? 'Aberta' : 'Fechada'}
                    </span>
                    <span className="text-[10px] text-sky-200">
                      Modo: {pumpMode === 'auto' ? 'Automático' : 'Manual'}
                    </span>
                  </div>
                </div>

                {/* Card 1: Nível da Água no App */}
                <div className="bg-[#0B1D35] border border-[#1A539B]/60 rounded-2xl p-3.5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-bold text-white">Nível da Água</h4>
                      <p className="text-[11px] text-sky-300/80">Monitoramento do aquário</p>
                    </div>
                    <span
                      className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                        isCritical
                          ? 'bg-rose-500/25 text-rose-300'
                          : isLow
                          ? 'bg-amber-500/25 text-amber-300'
                          : 'bg-sky-500/20 text-sky-200'
                      }`}
                    >
                      {isCritical ? 'Crítico' : isLow ? 'Atenção' : 'Ideal'}
                    </span>
                  </div>

                  {/* Tanque Mobile */}
                  <div className="relative h-36 rounded-xl bg-[#06101E] border border-[#1A539B] overflow-hidden flex items-end">
                    <div
                      className="w-full bg-gradient-to-t from-[#12386B] to-[#1A539B] border-t-2 border-sky-400 transition-all duration-500"
                      style={{ height: `${waterLevelPct}%` }}
                    />
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-3xl font-extrabold text-white drop-shadow">
                        {waterLevelPct}%
                      </span>
                      <span className="text-[10px] text-sky-100 bg-[#06101E]/70 px-2 py-0.5 rounded-full mt-0.5">
                        ~{Math.round((waterLevelPct / 100) * 120)} Litros
                      </span>
                    </div>
                  </div>
                </div>

                {/* Card 2: Bomba de Oxigênio */}
                <div className="bg-[#0B1D35] border border-[#1A539B]/60 rounded-2xl p-3.5 space-y-2.5">
                  <div>
                    <h4 className="text-sm font-bold text-white">Bomba de Oxigênio</h4>
                    <p className="text-[11px] text-sky-300/80">
                      Status: {pumpActive ? 'Aberta' : 'Fechada'}
                    </p>
                  </div>

                  <button
                    onClick={onTogglePump}
                    className={`w-full py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition ${
                      pumpActive
                        ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                        : 'bg-[#1A539B] text-white border border-sky-300/30'
                    }`}
                  >
                    <Power className="w-4 h-4" />
                    <span>{pumpActive ? 'Bomba Aberta (Toque p/ Fechar)' : 'Abrir Bomba de Oxigênio'}</span>
                  </button>

                  <div className="grid grid-cols-2 gap-1.5 bg-[#06101E] p-1 rounded-xl border border-[#1A539B]/40">
                    <button
                      onClick={() => setPumpMode('auto')}
                      className={`py-1.5 rounded-lg text-[11px] font-semibold ${
                        pumpMode === 'auto' ? 'bg-[#1A539B] text-white' : 'text-sky-200/70'
                      }`}
                    >
                      Ciclo Automático
                    </button>
                    <button
                      onClick={() => setPumpMode('manual')}
                      className={`py-1.5 rounded-lg text-[11px] font-semibold ${
                        pumpMode === 'manual' ? 'bg-[#1A539B] text-white' : 'text-sky-200/70'
                      }`}
                    >
                      Manual Fixo
                    </button>
                  </div>
                </div>

                {/* Card 3: Alimentador Automático */}
                <div className="bg-[#0B1D35] border border-[#1A539B]/60 rounded-2xl p-3.5 space-y-2.5">
                  <div>
                    <h4 className="text-sm font-bold text-white">Alimentador Automático</h4>
                    <p className="text-[11px] text-sky-300/80">Escolha a porção desejada</p>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5">
                    {['Leve (3g)', 'Padrão (5g)', 'Generosa (8g)'].map((p) => (
                      <button
                        key={p}
                        onClick={() => setSelectedPortion(p)}
                        className={`py-2 px-1 rounded-xl text-[10px] font-semibold border transition ${
                          selectedPortion === p
                            ? 'bg-[#1A539B] border-sky-400 text-white'
                            : 'bg-[#06101E] border-[#1A539B]/40 text-sky-200/70'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={() => onFeedNow()}
                    disabled={isFeeding}
                    className={`w-full py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition ${
                      isFeeding
                        ? 'bg-amber-400 text-slate-950 animate-pulse'
                        : 'bg-gradient-to-r from-[#1A539B] to-sky-500 text-white'
                    }`}
                  >
                    <Utensils className="w-4 h-4" />
                    <span>{isFeeding ? 'Dispensando Ração...' : `Alimentar Agora (${selectedPortion})`}</span>
                  </button>
                </div>
              </>
            )}

            {/* ABA 2 DO APK: AGENDA */}
            {mobileTab === 'agenda' && (
              <div className="bg-[#0B1D35] border border-[#1A539B]/60 rounded-2xl p-3.5 space-y-3">
                <div>
                  <h4 className="text-sm font-bold text-white">Horários Programados</h4>
                  <p className="text-[11px] text-sky-300/80">Salvos no ESP32 e no Supabase</p>
                </div>

                <div className="space-y-2">
                  {schedules.map((item) => (
                    <div
                      key={item.id}
                      className="bg-[#06101E] border border-[#1A539B]/50 rounded-xl p-3 flex items-center justify-between"
                    >
                      <div>
                        <div className="text-base font-extrabold font-mono-code text-white">
                          {item.time}
                        </div>
                        <div className="text-[11px] text-sky-300/80">
                          {item.portion} • {item.label}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onToggleSchedule(item.id)}
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
                          onClick={() => onDeleteSchedule(item.id)}
                          className="p-1 text-rose-400 hover:text-rose-300"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    onAddSchedule(e, newTime, selectedPortion);
                  }}
                  className="pt-2 border-t border-[#1A539B]/40 flex gap-2"
                >
                  <input
                    type="time"
                    value={newTime}
                    onChange={(e) => setNewTime(e.target.value)}
                    className="bg-[#06101E] border border-[#1A539B] rounded-xl px-3 py-2 text-xs font-mono-code text-white flex-1"
                  />
                  <button
                    type="submit"
                    className="bg-[#1A539B] text-white text-xs font-bold px-3.5 py-2 rounded-xl flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> Agendar
                  </button>
                </form>
              </div>
            )}

            {/* ABA 3 DO APK: CONEXÃO WI-FI / BLUETOOTH & FILA OFFLINE */}
            {mobileTab === 'conexao' && (
              <div className="space-y-3">
                <div className="bg-[#0B1D35] border border-[#1A539B]/60 rounded-2xl p-3.5 space-y-3">
                  <div>
                    <h4 className="text-sm font-bold text-white">Comunicação Híbrida do .APK</h4>
                    <p className="text-[11px] text-sky-300/80">
                      Teste o comportamento quando o Wi-Fi cai
                    </p>
                  </div>

                  <div className="bg-[#06101E] border border-[#1A539B]/50 rounded-xl p-3 space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-sky-200/70">Canal Ativo:</span>
                      <span className="font-bold text-sky-300">
                        {transport === 'wifi' ? 'Wi-Fi (Supabase)' : 'Bluetooth (BLE Direto)'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sky-200/70">Dispositivo BLE:</span>
                      <span className="font-mono-code text-white">NETUNO_ESP32</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sky-200/70">Fila Offline no ESP32:</span>
                      <span className="font-bold text-emerald-300">
                        {offlineQueueCount} registro(s)
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={handleSimulateWifiDrop}
                    className="w-full py-2.5 rounded-xl bg-[#1A539B] hover:bg-[#2364B8] text-white font-bold text-xs transition border border-sky-300/30"
                  >
                    {espOnline
                      ? 'Simular Queda do Wi-Fi (Mudar p/ Bluetooth)'
                      : 'Simular Retorno do Wi-Fi (Voltar p/ Supabase)'}
                  </button>

                  {offlineQueueCount > 0 && (
                    <button
                      onClick={handleRescueOfflineViaBle}
                      className="w-full py-2.5 rounded-xl bg-sky-400 text-slate-950 font-bold text-xs transition"
                    >
                      Resgatar {offlineQueueCount} Registros via Bluetooth → 4G
                    </button>
                  )}

                  {syncedFromBle && (
                    <div className="flex items-center gap-2 text-[11px] text-emerald-300 bg-emerald-500/15 border border-emerald-400/30 p-2.5 rounded-xl">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>Fila offline transferida via Bluetooth e enviada ao Supabase!</span>
                    </div>
                  )}
                </div>

                {/* Logs dentro do App */}
                <div className="bg-[#0B1D35] border border-[#1A539B]/60 rounded-2xl p-3.5 space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-sky-200">
                    Últimos Eventos
                  </h4>
                  {logs.slice(0, 4).map((l) => (
                    <div
                      key={l.id}
                      className="bg-[#06101E] border border-[#1A539B]/35 rounded-xl p-2.5 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold text-white truncate">
                          {l.message}
                        </div>
                        <div className="text-[9px] text-sky-300/80">{l.source}</div>
                      </div>
                      <span className="text-[10px] font-mono-code text-sky-200 shrink-0">
                        {l.time.replace('Hoje, ', '')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Barra de Navegação Inferior do App Android */}
          <div className="p-2 bg-[#081528] border-t border-[#1A539B]/40 grid grid-cols-3 gap-1.5">
            {[
              { id: 'painel', label: 'Painel' },
              { id: 'agenda', label: 'Alimentador' },
              { id: 'conexao', label: 'Wi-Fi / BLE' },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setMobileTab(t.id)}
                className={`py-2 rounded-xl text-xs font-bold transition ${
                  mobileTab === t.id
                    ? 'bg-[#1A539B] text-white shadow'
                    : 'text-sky-200/70 hover:text-white'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Barra home do Android */}
          <div className="bg-[#081528] pb-2 pt-0.5 flex justify-center">
            <div className="w-28 h-1 rounded-full bg-white/30"></div>
          </div>
        </div>
      </div>

      {/* COLUNA DIREITA: EXPLICAÇÃO E TESTE RÁPIDO DO COMPORTAMENTO DO .APK */}
      <div className="max-w-md space-y-4">
        <div className="bg-[#0B1D35]/90 border border-[#1A539B]/50 rounded-3xl p-6 space-y-4 shadow-xl">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-[#1A539B] border border-sky-300/30 flex items-center justify-center text-white">
              <Smartphone className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Simulador Interativo do .APK</h3>
              <p className="text-xs text-sky-200/75">
                Espelho fiel do projeto <code className="text-sky-300">mobile-app/App.js</code>
              </p>
            </div>
          </div>

          <p className="text-xs text-sky-100/80 leading-relaxed">
            Use o celular ao lado para testar todas as telas do aplicativo Android agora mesmo no navegador. Ele está sincronizado com o estado do aquário:
          </p>

          <div className="space-y-2.5 text-xs">
            <div className="bg-[#06101E]/85 border border-[#1A539B]/40 rounded-2xl p-3.5">
              <strong className="text-emerald-300 block mb-0.5">1. Teste a Queda de Internet (Wi-Fi → Bluetooth)</strong>
              <span className="text-sky-200/75">
                Clique no botão no canto superior direito do celular (<code className="text-sky-300">Wi-Fi • Nuvem</code>) ou na aba <strong>Wi-Fi / BLE</strong> para simular a queda do Wi-Fi. Veja o app chavear na hora para <strong>Bluetooth • BLE</strong> e resgatar os registros salvos na memória do ESP32!
              </span>
            </div>

            <div className="bg-[#06101E]/85 border border-[#1A539B]/40 rounded-2xl p-3.5">
              <strong className="text-sky-300 block mb-0.5">2. Controle em Tempo Real</strong>
              <span className="text-sky-200/75">
                Ligue/desligue o relé da bomba de oxigênio, acione o alimentador ou mude o nível da água no celular e veja tudo refletir no site e no app simultaneamente.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
