/**
 * ============================================================================
 * NETUNO — TESTE E CALIBRAÇÃO DO ALIMENTADOR (12 COMPARTIMENTOS + BARREIRAS)
 * ============================================================================
 * Mecânica do Alimentador:
 *   - 12 compartimentos de ração (3g cada -> 36g no total)
 *   - 12 barreiras intercaladas (mesma largura angular dos compartimentos)
 *   - 24 posições no total (360° / 24 = 15° por meia etapa):
 *       * Barreira -> Compartimento : 170 passos (~15°)
 *       * Compartimento -> Próximo  : 341 passos (~30°)
 *   - Posição inicial ao ligar o ESP32: BARREIRA tampando o furo (seguro para
 *     reabastecer) e estoque cheio (12/12 = 36g).
 *
 * Pinagem (mesma do netuno_esp32.ino):
 *   - IN1 -> GPIO 12
 *   - IN2 -> GPIO 13
 *   - IN3 -> GPIO 14
 *   - IN4 -> GPIO 27
 *
 * Biblioteca necessária na Arduino IDE:
 *   - AccelStepper (por Mike McCauley)
 *
 * Abra o Monitor Serial em 115200 baud ("Nova-linha" ou "Ambos, NL e CR").
 */

#include <AccelStepper.h>

// ===================== PINAGEM DO HARDWARE (ESP32) ==========================
#define IN1_PIN 12
#define IN2_PIN 13
#define IN3_PIN 14
#define IN4_PIN 27

// ===================== MECÂNICA E ESTOQUE DO ALIMENTADOR ====================
const int   TOTAL_COMPARTIMENTOS      = 12;     // 12 compartimentos no carrossel
const int   GRAMAS_POR_COMPARTIMENTO  = 3;      // 3g por compartimento (total: 36g)
const int   ALERTA_BAIXO_COMPS        = 4;      // Aviso amarelo quando restar <= 4 comps (12g)
const int   ALERTA_CRITICO_COMPS      = 2;      // Alerta crítico quando restar <= 2 comps (6g)

// ===================== CONFIGURAÇÃO CALIBRADA DO MOTOR ======================
const long  PASSOS_POR_VOLTA          = 4096;   // HALF4WIRE: 4096 passos = 360°
long        passosAlimentacao         = 341;    // 30°   -> Compartimento atual até o próximo
long        passosBarreira            = 170;    // 14.9° -> Barreira <-> Compartimento (meia etapa)
float       velocidadeMaxPassos       = 1000.0; // Velocidade máx. (passos/s)
float       aceleracaoPassos          = 600.0;  // Aceleração (passos/s²)
bool        inverterDirecao           = false;  // true = inverte sentido padrão do giro
bool        desligarBobinasAoParar    = true;   // true = desliga bobinas ao parar (não esquenta)

// --- Tremidinha ao final da alimentação (para soltar a ração no furo) ---
bool        ativarTremidaFinal        = true;   // true = dá tremidinha quando o compartimento alinha no furo
long        tremidaPassos             = 40;     // Calibrado: k 40
int         tremidaRepeticoes         = 4;      // Quantidade de idas e voltas
float       tremidaVelocidade         = 1000.0; // Velocidade da tremidinha (passos/s)
float       tremidaAceleracao         = 3000.0; // Aceleração alta = tranco seco para soltar a ração
unsigned long pausaEntreDosesMs       = 450;    // Pausa curta entre doses quando pedir 2+ compartimentos

// ===================== INSTÂNCIA DO MOTOR (AccelStepper) ====================
// Sequência correta para 28BYJ-48 + ULN2003 no AccelStepper: IN1, IN3, IN2, IN4
AccelStepper mp(AccelStepper::HALF4WIRE, IN1_PIN, IN3_PIN, IN2_PIN, IN4_PIN);

// ===================== ESTADO DO ALIMENTADOR ================================
bool alinhadoComBarreira   = true;                 // Começa com a BARREIRA tampando o furo
int  compartimentosRestantes = TOTAL_COMPARTIMENTOS; // Começa cheio: 12/12 (36g)

enum EstadoMotor {
  ESTADO_PARADO,
  ESTADO_MOVENDO,
  ESTADO_TREMIDINHA,
  ESTADO_PAUSA_PROX_DOSE,
  ESTADO_PAUSA_AUTO_BARREIRA
};

enum TipoAcao {
  ACAO_NENHUMA,
  ACAO_ALIMENTAR,
  ACAO_POSICIONAR_BARREIRA,
  ACAO_MANUAL_ALTERNAR_POS,
  ACAO_MANUAL_LIVRE
};

EstadoMotor   estadoMotor            = ESTADO_PARADO;
TipoAcao      acaoAtual              = ACAO_NENHUMA;
int           dosesPendentes         = 0;
int           dosesEntreguesNaSessao = 0;
int           etapasTremidaRestantes = 0;
int           sinalTremida           = 1;
unsigned long inicioMovMs            = 0;
unsigned long inicioPausaDoseMs      = 0;
String        entradaSerial          = "";

// ===================== FUNÇÕES AUXILIARES DO MOTOR ==========================
void desligarBobinas() {
  mp.disableOutputs();
  digitalWrite(IN1_PIN, LOW);
  digitalWrite(IN2_PIN, LOW);
  digitalWrite(IN3_PIN, LOW);
  digitalWrite(IN4_PIN, LOW);
}

void aplicarConfigMotor() {
  mp.setMaxSpeed(velocidadeMaxPassos);
  mp.setAcceleration(aceleracaoPassos);
}

void iniciarTremidinha() {
  if (tremidaPassos <= 0 || tremidaRepeticoes <= 0) {
    estadoMotor = ESTADO_PARADO;
    if (desligarBobinasAoParar) desligarBobinas();
    return;
  }
  mp.enableOutputs();
  mp.setMaxSpeed(tremidaVelocidade);
  mp.setAcceleration(tremidaAceleracao);
  etapasTremidaRestantes = tremidaRepeticoes * 2;
  sinalTremida = 1;
  estadoMotor = ESTADO_TREMIDINHA;
  mp.move(sinalTremida * tremidaPassos);
  sinalTremida = -sinalTremida;
  etapasTremidaRestantes--;
  Serial.printf("   ~ [TREMIDINHA] %dx (+/-%ld passos) para garantir queda da racao...\n",
                tremidaRepeticoes, tremidaPassos);
}

void moverMotor(long passos, TipoAcao tipo, const char* descricao) {
  long passosFinais = inverterDirecao ? -passos : passos;
  aplicarConfigMotor();
  mp.enableOutputs();
  mp.move(passosFinais);
  estadoMotor = ESTADO_MOVENDO;
  acaoAtual = tipo;
  inicioMovMs = millis();

  float graus = (360.0f * (float)abs(passos)) / (float)PASSOS_POR_VOLTA;
  Serial.printf(">> [MOTOR] %s | Passos: %ld (%.1f graus)\n", descricao, passosFinais, graus);
}

// ===================== VISUALIZAÇÃO DE ESTOQUE E ALERTAS ====================
void imprimirBarraEstoque() {
  Serial.print("  Nivel visual    : [");
  for (int i = 0; i < TOTAL_COMPARTIMENTOS; i++) {
    Serial.print(i < compartimentosRestantes ? '#' : '-');
  }
  int gramasAtuais = compartimentosRestantes * GRAMAS_POR_COMPARTIMENTO;
  int gramasMax    = TOTAL_COMPARTIMENTOS * GRAMAS_POR_COMPARTIMENTO;
  int pct          = (compartimentosRestantes * 100) / TOTAL_COMPARTIMENTOS;
  Serial.printf("] %d/%d (%dg de %dg | %d%%)\n",
                compartimentosRestantes, TOTAL_COMPARTIMENTOS, gramasAtuais, gramasMax, pct);
}

void verificarAlertasEstoque() {
  int gramasAtuais = compartimentosRestantes * GRAMAS_POR_COMPARTIMENTO;
  if (compartimentosRestantes <= 0) {
    if (alinhadoComBarreira) {
      Serial.println("  [!!! CRITICO - VAZIO !!!] Acabou a racao (0g) — Alimentacao parada com BARREIRA no furo.");
      Serial.println("  -> Reabasteca os compartimentos e envie 'o' para confirmar.");
    } else {
      Serial.println("  [!!! CRITICO - VAZIO !!!] Acabou a racao (0g)!");
      Serial.println("  -> Envie 'u' para alinhar a BARREIRA no furo e reabastecer.");
    }
  } else if (compartimentosRestantes <= ALERTA_CRITICO_COMPS) {
    Serial.printf("  [!! ALERTA CRITICO !!] Racao quase acabando: apenas %d compartimento(s) (%dg)!\n",
                  compartimentosRestantes, gramasAtuais);
  } else if (compartimentosRestantes <= ALERTA_BAIXO_COMPS) {
    Serial.printf("  [! AVISO !] Estoque baixo: restam %d compartimentos (%dg). Prepare o reabastecimento.\n",
                  compartimentosRestantes, gramasAtuais);
  } else {
    Serial.printf("  Status estoque  : OK (%dg disponiveis)\n", gramasAtuais);
  }
}

void mostrarStatusCompleto() {
  Serial.println("\n==================== STATUS DO ALIMENTADOR ====================");
  Serial.printf("  Posicao no furo : %s\n",
                alinhadoComBarreira
                  ? "BARREIRA (furo tampado - seguro para reabastecer)"
                  : "COMPARTIMENTO (modo operacao normal)");
  imprimirBarraEstoque();
  verificarAlertasEstoque();
  Serial.println("---------------------------------------------------------------");
  Serial.printf("  Config motor    : Vel=%.0f | Acel=%.0f | Direcao=%s\n",
                velocidadeMaxPassos, aceleracaoPassos, inverterDirecao ? "INVERTIDA" : "NORMAL");
  Serial.printf("  Passos          : Alimentacao=%ld (%.1f°) | Barreira=%ld (%.1f°)\n",
                passosAlimentacao, (360.0f * passosAlimentacao) / PASSOS_POR_VOLTA,
                passosBarreira, (360.0f * passosBarreira) / PASSOS_POR_VOLTA);
  Serial.printf("  Tremidinha      : %s (%dx de +/-%ld passos)\n",
                ativarTremidaFinal ? "LIGADA" : "DESLIGADA", tremidaRepeticoes, tremidaPassos);
  Serial.println("===============================================================");
}

void mostrarMenu() {
  Serial.println("\n================= COMANDOS (SERIAL 115200) =================");
  Serial.println("  --- OPERACAO NORMAL E REABASTECIMENTO ---");
  Serial.println("  g [qtd]    -> Alimentar 1 dose (3g) ou mais (ex: g 2 = 6g)");
  Serial.println("  ENTER      -> Atalho rapido para alimentar 1 dose (3g)");
  Serial.println("  u          -> MODO REABASTECER (coloca a BARREIRA no furo)");
  Serial.println("  o [qtd]    -> Confirmar reabastecimento (padrao: 12 = 36g)");
  Serial.println("  ?          -> Mostrar status visual da racao e este menu");
  Serial.println();
  Serial.println("  --- AJUSTES FINOS E TESTES MANUAIS ---");
  Serial.println("  b          -> Mover 1 meia-etapa manual (Barreira <-> Comp.)");
  Serial.println("  r [passos] -> Reverso manual (padrao: -170 passos)");
  Serial.println("  a <graus>  -> Girar angulo livre (ex: a 15 ou a -30)");
  Serial.println("  w          -> Testar SO a tremidinha agora");
  Serial.println("  v          -> Ligar/Desligar tremidinha ao alimentar");
  Serial.println("  p <passos> -> Alterar passosAlimentacao (atual: 341)");
  Serial.println("  h <passos> -> Alterar passosBarreira    (atual: 170)");
  Serial.println("  k <passos> -> Alterar amplitude tremida (atual: 40)");
  Serial.println("  n <reps>   -> Alterar repeticoes tremida(atual: 4)");
  Serial.println("  s <vel>    -> Alterar velocidade        (atual: 1000)");
  Serial.println("  c <acel>   -> Alterar aceleracao        (atual: 600)");
  Serial.println("  i          -> Inverter direcao padrao");
  Serial.println("  x          -> PARAR motor imediatamente");
  Serial.println("============================================================");
}

// ===================== FLUXO DE ALIMENTAÇÃO E REABASTECIMENTO ===============
void dispararProximaDose() {
  if (compartimentosRestantes <= 0 || dosesPendentes <= 0) {
    dosesPendentes = 0;
    acaoAtual = ACAO_NENHUMA;
    estadoMotor = ESTADO_PARADO;
    if (desligarBobinasAoParar) desligarBobinas();
    mostrarStatusCompleto();
    return;
  }

  // Se estiver na BARREIRA, basta 1 meia etapa (170 passos) para cair no 1º compartimento.
  // Se já estiver em um COMPARTIMENTO vazio, precisa de 1 etapa completa (341 passos) até o próximo.
  if (alinhadoComBarreira) {
    moverMotor(passosBarreira, ACAO_ALIMENTAR, "Barreira -> 1o Compartimento (3g)");
  } else {
    moverMotor(passosAlimentacao, ACAO_ALIMENTAR, "Proximo Compartimento (3g)");
  }
}

void iniciarAlimentacao(int qtdDoses) {
  if (qtdDoses < 1) qtdDoses = 1;

  if (compartimentosRestantes <= 0) {
    if (!alinhadoComBarreira) {
      Serial.println("\n[BLOQUEADO] Sem comida (0/12 = 0g)! Alinhando BARREIRA automaticamente...");
      moverMotor(passosBarreira, ACAO_POSICIONAR_BARREIRA, "Auto: Sem comida -> Alinhando BARREIRA");
      return;
    }
    Serial.println("\n[BLOQUEADO] Alimentador VAZIO (0/12 = 0g) — Alimentacao parada com BARREIRA no furo!");
    Serial.println("-> Reabasteca os compartimentos e envie 'o' para confirmar.");
    return;
  }

  if (qtdDoses > compartimentosRestantes) {
    Serial.printf("\n[AVISO] Voce pediu %d dose(s) (%dg), mas so restam %d compartimento(s) (%dg).\n",
                  qtdDoses, qtdDoses * GRAMAS_POR_COMPARTIMENTO,
                  compartimentosRestantes, compartimentosRestantes * GRAMAS_POR_COMPARTIMENTO);
    Serial.printf("-> Entregando as %d dose(s) restantes.\n", compartimentosRestantes);
    qtdDoses = compartimentosRestantes;
  }

  dosesPendentes = qtdDoses;
  dosesEntreguesNaSessao = 0;
  Serial.printf("\n================ ALIMENTANDO: %d dose(s) (%dg) ================\n",
                qtdDoses, qtdDoses * GRAMAS_POR_COMPARTIMENTO);
  dispararProximaDose();
}

void iniciarModoReabastecer() {
  Serial.println("\n================ MODO REABASTECIMENTO ================");
  if (alinhadoComBarreira) {
    Serial.println("[PRONTO] A BARREIRA ja esta tampando o furo!");
    Serial.printf("-> Pode reabastecer os %d compartimentos (%dg cada = %dg total).\n",
                  TOTAL_COMPARTIMENTOS, GRAMAS_POR_COMPARTIMENTO,
                  TOTAL_COMPARTIMENTOS * GRAMAS_POR_COMPARTIMENTO);
    Serial.println("-> Quando terminar, envie 'o' para confirmar estoque cheio (ou 'o <qtd>').");
  } else {
    Serial.println("Alinhando a BARREIRA sobre o furo para travar a saida de racao...");
    moverMotor(passosBarreira, ACAO_POSICIONAR_BARREIRA, "Compartimento -> BARREIRA (tampando furo)");
  }
}

void confirmarReabastecimento(int qtdComps) {
  if (qtdComps < 1 || qtdComps > TOTAL_COMPARTIMENTOS) {
    Serial.printf("[ERRO] Informe uma quantidade entre 1 e %d. Ex: o 12\n", TOTAL_COMPARTIMENTOS);
    return;
  }

  compartimentosRestantes = qtdComps;
  if (!alinhadoComBarreira) {
    Serial.printf("\n[REABASTECIDO!] Estoque atualizado para %d/%d compartimentos (%dg).\n",
                  compartimentosRestantes, TOTAL_COMPARTIMENTOS,
                  compartimentosRestantes * GRAMAS_POR_COMPARTIMENTO);
    Serial.println("-> Alinhando BARREIRA no furo automaticamente para preparar o motor...");
    moverMotor(passosBarreira, ACAO_POSICIONAR_BARREIRA, "Reabastecimento -> Alinhando BARREIRA para iniciar novo ciclo");
    return;
  }

  Serial.printf("\n[REABASTECIDO!] Estoque atualizado para %d/%d compartimentos (%dg).\n",
                compartimentosRestantes, TOTAL_COMPARTIMENTOS,
                compartimentosRestantes * GRAMAS_POR_COMPARTIMENTO);
  mostrarStatusCompleto();
}

void finalizarEtapaAtual() {
  unsigned long duracaoMs = millis() - inicioMovMs;

  if (acaoAtual == ACAO_ALIMENTAR) {
    alinhadoComBarreira = false;
    if (compartimentosRestantes > 0) compartimentosRestantes--;
    dosesPendentes--;
    dosesEntreguesNaSessao++;

    Serial.printf("<< [DOSE %d ENTREGUE] +%dg dispensados | Tempo: %lu ms | Restam: %d/%d (%dg)\n",
                  dosesEntreguesNaSessao, GRAMAS_POR_COMPARTIMENTO, duracaoMs,
                  compartimentosRestantes, TOTAL_COMPARTIMENTOS,
                  compartimentosRestantes * GRAMAS_POR_COMPARTIMENTO);

    if (compartimentosRestantes <= 0) {
      // Comida terminou: aguarda breve pausa e alinha automaticamente com a barreira para parar alimentação
      dosesPendentes = 0;
      acaoAtual = ACAO_NENHUMA;
      estadoMotor = ESTADO_PAUSA_AUTO_BARREIRA;
      inicioPausaDoseMs = millis();
      aplicarConfigMotor();
      return;
    }

    if (dosesPendentes > 0 && compartimentosRestantes > 0) {
      estadoMotor = ESTADO_PAUSA_PROX_DOSE;
      inicioPausaDoseMs = millis();
      return;
    }

    // Sessão de alimentação finalizada
    acaoAtual = ACAO_NENHUMA;
    estadoMotor = ESTADO_PARADO;
    aplicarConfigMotor();
    if (desligarBobinasAoParar) desligarBobinas();
    mostrarStatusCompleto();
    return;
  }

  if (acaoAtual == ACAO_POSICIONAR_BARREIRA) {
    alinhadoComBarreira = true;
    acaoAtual = ACAO_NENHUMA;
    estadoMotor = ESTADO_PARADO;
    if (desligarBobinasAoParar) desligarBobinas();
    Serial.printf("<< [BARREIRA NO FURO!] Furo tampado com sucesso (%lu ms).\n", duracaoMs);
    Serial.println("-> Pode colocar a racao nos 12 compartimentos (3g cada = 36g).");
    Serial.println("-> Ao terminar, envie 'o' para confirmar o reabastecimento!");
    mostrarStatusCompleto();
    return;
  }

  if (acaoAtual == ACAO_MANUAL_ALTERNAR_POS) {
    alinhadoComBarreira = !alinhadoComBarreira;
    acaoAtual = ACAO_NENHUMA;
    estadoMotor = ESTADO_PARADO;
    if (desligarBobinasAoParar) desligarBobinas();
    Serial.printf("<< [AJUSTE MANUAL] Agora alinhado com: %s (%lu ms)\n",
                  alinhadoComBarreira ? "BARREIRA" : "COMPARTIMENTO", duracaoMs);
    return;
  }

  // ACAO_MANUAL_LIVRE ou teste isolado de tremidinha
  acaoAtual = ACAO_NENHUMA;
  estadoMotor = ESTADO_PARADO;
  aplicarConfigMotor();
  if (desligarBobinasAoParar) desligarBobinas();
  Serial.printf("<< [CONCLUIDO] Tempo: %lu ms | Posicao absoluta: %ld passos\n",
                duracaoMs, mp.currentPosition());
}

// ===================== LEITURA E INTERPRETAÇÃO SERIAL =======================
void processarComando(String cmd) {
  cmd.trim();

  // Parada de emergência funciona a qualquer momento
  if (cmd.length() > 0 && tolower(cmd.charAt(0)) == 'x') {
    bool estavaEmMovimento = (estadoMotor != ESTADO_PARADO);
    mp.stop();
    mp.setCurrentPosition(mp.currentPosition());
    estadoMotor = ESTADO_PARADO;
    acaoAtual = ACAO_NENHUMA;
    dosesPendentes = 0;
    etapasTremidaRestantes = 0;
    desligarBobinas();
    Serial.println("\n[PARADO] Motor interrompido imediatamente e bobinas desligadas.");
    if (estavaEmMovimento) {
      Serial.println("[AVISO] O motor parou durante um movimento: ajuste a posicao angular ('a <graus>' ou 'b') antes do proximo ciclo.");
    }
    return;
  }

  // Enquanto estiver se movendo, bloqueia novos comandos para não perder contagem
  if (estadoMotor != ESTADO_PARADO) {
    Serial.println("[AGUARDE] Motor em movimento... (envie 'x' para parar imediatamente)");
    return;
  }

  if (cmd.length() == 0) {
    // ENTER rápido = alimentar 1 dose (3g)
    iniciarAlimentacao(1);
    return;
  }

  char acao = tolower(cmd.charAt(0));
  String argStr = cmd.substring(1);
  argStr.trim();

  switch (acao) {
    case 'g': {
      int qtd = (argStr.length() > 0) ? argStr.toInt() : 1;
      iniciarAlimentacao(qtd);
      break;
    }

    case 'u':
      iniciarModoReabastecer();
      break;

    case 'o': {
      int qtd = (argStr.length() > 0) ? argStr.toInt() : TOTAL_COMPARTIMENTOS;
      confirmarReabastecimento(qtd);
      break;
    }

    case 'b':
      moverMotor(passosBarreira, ACAO_MANUAL_ALTERNAR_POS,
                 alinhadoComBarreira ? "Manual: Barreira -> Compartimento" : "Manual: Compartimento -> Barreira");
      break;

    case 'r': {
      long passosRev = (argStr.length() > 0) ? abs(argStr.toInt()) : passosBarreira;
      if (passosRev == 0) passosRev = passosBarreira;
      moverMotor(-passosRev, ACAO_MANUAL_LIVRE, "Reverso manual (nao altera contagem)");
      break;
    }

    case 'a': {
      if (argStr.length() == 0) {
        Serial.println("[ERRO] Informe o angulo. Ex: a 15 ou a -30");
        break;
      }
      float graus = argStr.toFloat();
      long passosAngulo = lround((graus / 360.0f) * (float)PASSOS_POR_VOLTA);
      if (passosAngulo == 0) {
        Serial.println("[AVISO] Angulo resultou em 0 passos.");
        break;
      }
      moverMotor(passosAngulo, ACAO_MANUAL_LIVRE, "Angulo manual (nao altera contagem)");
      break;
    }

    case 'w':
      inicioMovMs = millis();
      acaoAtual = ACAO_MANUAL_LIVRE;
      iniciarTremidinha();
      break;

    case 'v':
      ativarTremidaFinal = !ativarTremidaFinal;
      Serial.printf("[OK] tremidinhaFinal agora esta: %s\n", ativarTremidaFinal ? "LIGADA" : "DESLIGADA");
      break;

    case 'p': {
      long novo = argStr.toInt();
      if (novo < 10 || novo > 4096) {
        Serial.println("[ERRO] Informe entre 10 e 4096 passos. Ex: p 341");
        break;
      }
      passosAlimentacao = novo;
      Serial.printf("[OK] passosAlimentacao = %ld (%.1f graus)\n",
                    passosAlimentacao, (360.0f * passosAlimentacao) / PASSOS_POR_VOLTA);
      break;
    }

    case 'h': {
      long novo = argStr.toInt();
      if (novo < 10 || novo > 2048) {
        Serial.println("[ERRO] Informe entre 10 e 2048 passos. Ex: h 170");
        break;
      }
      passosBarreira = novo;
      Serial.printf("[OK] passosBarreira = %ld (%.1f graus)\n",
                    passosBarreira, (360.0f * passosBarreira) / PASSOS_POR_VOLTA);
      break;
    }

    case 'k': {
      long amp = argStr.toInt();
      if (amp < 10 || amp > 500) {
        Serial.println("[ERRO] Amplitude recomendada entre 10 e 500 passos. Ex: k 40");
        break;
      }
      tremidaPassos = amp;
      Serial.printf("[OK] tremidaPassos = %ld passos\n", tremidaPassos);
      break;
    }

    case 'n': {
      int reps = argStr.toInt();
      if (reps < 1 || reps > 20) {
        Serial.println("[ERRO] Repeticoes recomendadas entre 1 e 20. Ex: n 4");
        break;
      }
      tremidaRepeticoes = reps;
      Serial.printf("[OK] tremidaRepeticoes = %d\n", tremidaRepeticoes);
      break;
    }

    case 's': {
      float novaVel = argStr.toFloat();
      if (novaVel < 50.0f || novaVel > 3000.0f) {
        Serial.println("[ERRO] Velocidade recomendada entre 50 e 3000. Ex: s 1000");
        break;
      }
      velocidadeMaxPassos = novaVel;
      aplicarConfigMotor();
      Serial.printf("[OK] velocidadeMaxPassos = %.1f passos/s\n", velocidadeMaxPassos);
      break;
    }

    case 'c': {
      float novaAcel = argStr.toFloat();
      if (novaAcel < 20.0f || novaAcel > 5000.0f) {
        Serial.println("[ERRO] Aceleracao recomendada entre 20 e 5000. Ex: c 600");
        break;
      }
      aceleracaoPassos = novaAcel;
      aplicarConfigMotor();
      Serial.printf("[OK] aceleracaoPassos = %.1f passos/s^2\n", aceleracaoPassos);
      break;
    }

    case 'i':
      inverterDirecao = !inverterDirecao;
      Serial.printf("[OK] inverterDirecao agora esta: %s\n", inverterDirecao ? "SIM (-)" : "NAO (+)");
      break;

    case '?':
      mostrarStatusCompleto();
      mostrarMenu();
      break;

    default:
      Serial.printf("[?] Comando desconhecido: '%s'. Envie '?' para ver o menu.\n", cmd.c_str());
      break;
  }
}

void lerSerial() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      processarComando(entradaSerial);
      entradaSerial = "";
    } else if (entradaSerial.length() < 64) {
      entradaSerial += c;
    }
  }
}

// ===================== SETUP E LOOP =========================================
void setup() {
  Serial.begin(115200);
  delay(400);

  aplicarConfigMotor();
  desligarBobinas();

  Serial.println("\n===============================================================");
  Serial.println("   NETUNO — TESTE DO ALIMENTADOR (12 COMPARTIMENTOS x 3g)      ");
  Serial.println("===============================================================");
  Serial.printf("Pinagem: IN1=%d | IN2=%d | IN3=%d | IN4=%d\n",
                IN1_PIN, IN2_PIN, IN3_PIN, IN4_PIN);

  mostrarStatusCompleto();
  mostrarMenu();
}

void loop() {
  lerSerial();

  if (estadoMotor == ESTADO_MOVENDO) {
    mp.run();

    if (mp.distanceToGo() == 0) {
      // Só dá tremidinha quando acabou de alinhar um COMPARTIMENTO para alimentar
      if (acaoAtual == ACAO_ALIMENTAR && ativarTremidaFinal && tremidaPassos > 0 && tremidaRepeticoes > 0) {
        iniciarTremidinha();
      } else {
        finalizarEtapaAtual();
      }
    }
  } else if (estadoMotor == ESTADO_TREMIDINHA) {
    mp.run();

    if (mp.distanceToGo() == 0) {
      if (etapasTremidaRestantes > 0) {
        mp.move(sinalTremida * tremidaPassos);
        sinalTremida = -sinalTremida;
        etapasTremidaRestantes--;
      } else {
        finalizarEtapaAtual();
      }
    }
  } else if (estadoMotor == ESTADO_PAUSA_PROX_DOSE) {
    if (millis() - inicioPausaDoseMs >= pausaEntreDosesMs) {
      dispararProximaDose();
    }
  } else if (estadoMotor == ESTADO_PAUSA_AUTO_BARREIRA) {
    if (millis() - inicioPausaDoseMs >= 450) {
      Serial.println("\n[AUTO] Comida terminou (0/12)! Alinhando BARREIRA no furo e parando alimentacao...");
      moverMotor(passosBarreira, ACAO_POSICIONAR_BARREIRA, "Auto: Comida terminou -> BARREIRA (parar alimentacao)");
    }
  }
}
