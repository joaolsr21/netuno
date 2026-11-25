/**
 * ============================================================================
 * NETUNO — CÓDIGO DE TESTE E CALIBRAÇÃO DO ALIMENTADOR (MOTOR DE PASSO)
 * ============================================================================
 * Biblioteca necessária na Arduino IDE:
 *   - AccelStepper (por Mike McCauley) -> Gerenciador de Bibliotecas
 *
 * Pinagem (mesma do projeto principal netuno_esp32.ino):
 *   - IN1 -> GPIO 12
 *   - IN2 -> GPIO 13
 *   - IN3 -> GPIO 14
 *   - IN4 -> GPIO 27
 *
 * COMO USAR:
 * 1) Você pode alterar os valores logo abaixo ("CONFIGURAÇÃO RÁPIDA") e enviar
 *    para o ESP32, OU
 * 2) Abrir o Monitor Serial em 115200 baud para testar e ajustar passos,
 *    velocidade, aceleração, ângulo e sentido EM TEMPO REAL sem precisar
 *    regravar o código a cada teste!
 */

#include <AccelStepper.h>

// ===================== PINAGEM DO HARDWARE (ESP32) ==========================
#define IN1_PIN 12
#define IN2_PIN 13
#define IN3_PIN 14
#define IN4_PIN 27

// ===================== CONFIGURAÇÃO RÁPIDA (EDITE AQUI) =====================
// Modo do motor 28BYJ-48 + driver ULN2003:
//   HALF4WIRE -> 4096 passos = 1 volta completa (mais suave e preciso)
//   FULL4WIRE -> 2048 passos = 1 volta completa (mais torque, passos maiores)
const long  PASSOS_POR_VOLTA          = 4096;   // 4096 para HALF4WIRE | 2048 para FULL4WIRE

long        passosPorAcionamento      = 2048;   // Quantidade de passos por teste (2048 = meia volta)
float       velocidadeMaxPassos       = 1000.0; // Velocidade máx. (passos/seg) — teste entre 400 e 1200
float       aceleracaoPassos          = 600.0;  // Aceleração (passos/seg²) — rampa suave na partida
bool        inverterDirecao           = false;  // true = inverte o sentido padrão do giro
bool        desligarBobinasAoParar    = true;   // true = desliga as bobinas parado (não esquenta)

bool        girarAoIniciar            = false;  // true = faz 1 giro automático assim que o ESP32 liga
bool        modoLoopAutomatico        = false;  // true = repete o giro sozinho a cada pausa
unsigned long pausaEntreGirosMs       = 3000;   // Tempo de pausa entre giros no modo automático (ms)

// --- Tremidinha ao final do giro (para soltar ração grudada) ---
bool        ativarTremidaFinal        = true;   // true = dá uma tremidinha ao terminar cada giro
long        tremidaPassos             = 80;     // Amplitude de cada sacudida (~7° em HALF4WIRE; teste 50..150)
int         tremidaRepeticoes         = 4;      // Quantidade de idas e voltas da tremidinha
float       tremidaVelocidade         = 1000.0; // Velocidade da tremidinha (passos/s)
float       tremidaAceleracao         = 3000.0; // Aceleração alta = tranco seco que solta melhor a ração

// ===================== INSTÂNCIA DO MOTOR (AccelStepper) ====================
// Atenção: no 28BYJ-48 + ULN2003 a sequência correta no AccelStepper é IN1, IN3, IN2, IN4
AccelStepper mp(AccelStepper::HALF4WIRE, IN1_PIN, IN3_PIN, IN2_PIN, IN4_PIN);

// ===================== CONTROLE INTERNO =====================================
enum EstadoMotor {
  ESTADO_PARADO,
  ESTADO_GIRANDO,
  ESTADO_TREMIDINHA
};

EstadoMotor   estadoMotor      = ESTADO_PARADO;
int           etapasTremidaRestantes = 0; // Cada repetição = 2 etapas (ida + volta, saldo final = 0 passos)
int           sinalTremida     = 1;
unsigned long inicioMovMs      = 0;
unsigned long ultimoFimMovMs   = 0;
String        entradaSerial    = "";

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
  Serial.printf("   ~ [TREMIDINHA] %dx (+/-%ld passos)...\n", tremidaRepeticoes, tremidaPassos);
}

void iniciarMovimento(long passos, const char* descricao) {
  long passosFinais = inverterDirecao ? -passos : passos;
  aplicarConfigMotor();
  mp.enableOutputs();
  mp.move(passosFinais);
  estadoMotor = ESTADO_GIRANDO;
  inicioMovMs = millis();

  float graus = (360.0f * (float)abs(passos)) / (float)PASSOS_POR_VOLTA;
  Serial.println();
  Serial.printf(">> [GIRANDO] %s | Passos: %ld (%.1f graus) | Vel: %.0f | Acel: %.0f\n",
                descricao, passosFinais, graus, velocidadeMaxPassos, aceleracaoPassos);
}

void mostrarConfigAtual() {
  float graus = (360.0f * (float)passosPorAcionamento) / (float)PASSOS_POR_VOLTA;
  Serial.println("\n================ CONFIGURACAO ATUAL ================");
  Serial.printf("  passosPorAcionamento = %ld  (%.1f graus)\n", passosPorAcionamento, graus);
  Serial.printf("  velocidadeMaxPassos  = %.1f passos/s\n", velocidadeMaxPassos);
  Serial.printf("  aceleracaoPassos     = %.1f passos/s^2\n", aceleracaoPassos);
  Serial.printf("  inverterDirecao      = %s\n", inverterDirecao ? "SIM (-)" : "NAO (+)");
  Serial.printf("  tremidinhaFinal      = %s (%dx de +/-%ld passos | vel %.0f | acel %.0f)\n",
                ativarTremidaFinal ? "LIGADA" : "DESLIGADA",
                tremidaRepeticoes, tremidaPassos, tremidaVelocidade, tremidaAceleracao);
  Serial.printf("  modoLoopAutomatico   = %s (pausa: %lu ms)\n",
                modoLoopAutomatico ? "LIGADO" : "DESLIGADO", pausaEntreGirosMs);
  Serial.printf("  desligarBobinas      = %s\n", desligarBobinasAoParar ? "SIM" : "NAO");
  Serial.println("====================================================");
}

void mostrarMenu() {
  Serial.println("\n================ COMANDOS (SERIAL 115200) ================");
  Serial.println("  g          -> Girar (passosPorAcionamento atual)");
  Serial.println("  r          -> Girar no sentido contrario (reverso)");
  Serial.println("  v          -> 1 volta completa (360 graus)");
  Serial.println("  m          -> Meia volta (180 graus)");
  Serial.println("  q          -> 1/4 de volta (90 graus)");
  Serial.println("  a <graus>  -> Girar angulo exato (ex: a 30 ou a -90)");
  Serial.println("  p <passos> -> Alterar passosPorAcionamento (ex: p 341)");
  Serial.println("  s <vel>    -> Alterar velocidadeMaxPassos  (ex: s 900)");
  Serial.println("  c <acel>   -> Alterar aceleracaoPassos     (ex: c 500)");
  Serial.println("  w          -> Testar SO a tremidinha agora");
  Serial.println("  b          -> Ligar/Desligar tremidinha ao final do giro");
  Serial.println("  k <passos> -> Amplitude da tremidinha      (ex: k 100)");
  Serial.println("  n <reps>   -> Repeticoes da tremidinha     (ex: n 5)");
  Serial.println("  d <ms>     -> Alterar pausa do loop auto   (ex: d 2000)");
  Serial.println("  i          -> Inverter direcao padrao");
  Serial.println("  t          -> Ligar/Desligar modo loop automatico");
  Serial.println("  x          -> PARAR motor imediatamente");
  Serial.println("  ?          -> Mostrar configuracao atual e menu");
  Serial.println("==========================================================");
}

void processarComando(String cmd) {
  cmd.trim();
  if (cmd.length() == 0) {
    // Apertar apenas ENTER no Monitor Serial dispara um teste rápido
    iniciarMovimento(passosPorAcionamento, "Teste (ENTER)");
    return;
  }

  char acao = tolower(cmd.charAt(0));
  String argStr = cmd.substring(1);
  argStr.trim();

  switch (acao) {
    case 'g':
      iniciarMovimento(passosPorAcionamento, "Dose configurada");
      break;

    case 'r':
      iniciarMovimento(-passosPorAcionamento, "Reverso");
      break;

    case 'v':
      iniciarMovimento(PASSOS_POR_VOLTA, "1 volta (360 graus)");
      break;

    case 'm':
      iniciarMovimento(PASSOS_POR_VOLTA / 2, "Meia volta (180 graus)");
      break;

    case 'q':
      iniciarMovimento(PASSOS_POR_VOLTA / 4, "1/4 de volta (90 graus)");
      break;

    case 'a': {
      if (argStr.length() == 0) {
        Serial.println("[ERRO] Informe o angulo. Ex: a 90 ou a -45");
        break;
      }
      float graus = argStr.toFloat();
      long passosAngulo = lround((graus / 360.0f) * (float)PASSOS_POR_VOLTA);
      if (passosAngulo == 0) {
        Serial.println("[AVISO] Angulo resultou em 0 passos.");
        break;
      }
      iniciarMovimento(passosAngulo, "Angulo manual");
      break;
    }

    case 'p': {
      long novo = argStr.toInt();
      if (novo == 0) {
        Serial.println("[ERRO] Informe um numero de passos diferente de 0. Ex: p 1500");
        break;
      }
      passosPorAcionamento = novo;
      Serial.printf("[OK] passosPorAcionamento alterado para %ld\n", passosPorAcionamento);
      mostrarConfigAtual();
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
      Serial.printf("[OK] velocidadeMaxPassos alterada para %.1f passos/s\n", velocidadeMaxPassos);
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
      Serial.printf("[OK] aceleracaoPassos alterada para %.1f passos/s^2\n", aceleracaoPassos);
      break;
    }

    case 'd': {
      long novaPausa = argStr.toInt();
      if (novaPausa < 200) {
        Serial.println("[ERRO] Pausa minima de 200 ms. Ex: d 3000");
        break;
      }
      pausaEntreGirosMs = (unsigned long)novaPausa;
      Serial.printf("[OK] pausaEntreGirosMs alterada para %lu ms\n", pausaEntreGirosMs);
      break;
    }

    case 'i':
      inverterDirecao = !inverterDirecao;
      Serial.printf("[OK] inverterDirecao agora esta: %s\n", inverterDirecao ? "SIM (-)" : "NAO (+)");
      break;

    case 't':
      modoLoopAutomatico = !modoLoopAutomatico;
      ultimoFimMovMs = millis();
      Serial.printf("[OK] modoLoopAutomatico agora esta: %s\n", modoLoopAutomatico ? "LIGADO" : "DESLIGADO");
      break;

    case 'w':
      inicioMovMs = millis();
      iniciarTremidinha();
      break;

    case 'b':
      ativarTremidaFinal = !ativarTremidaFinal;
      Serial.printf("[OK] tremidinhaFinal agora esta: %s\n", ativarTremidaFinal ? "LIGADA" : "DESLIGADA");
      break;

    case 'k': {
      long amp = argStr.toInt();
      if (amp < 10 || amp > 500) {
        Serial.println("[ERRO] Amplitude recomendada entre 10 e 500 passos. Ex: k 80");
        break;
      }
      tremidaPassos = amp;
      Serial.printf("[OK] tremidaPassos alterado para %ld passos\n", tremidaPassos);
      break;
    }

    case 'n': {
      int reps = argStr.toInt();
      if (reps < 1 || reps > 20) {
        Serial.println("[ERRO] Repeticoes recomendadas entre 1 e 20. Ex: n 4");
        break;
      }
      tremidaRepeticoes = reps;
      Serial.printf("[OK] tremidaRepeticoes alterado para %d\n", tremidaRepeticoes);
      break;
    }

    case 'x':
      mp.stop();
      mp.setCurrentPosition(mp.currentPosition());
      estadoMotor = ESTADO_PARADO;
      etapasTremidaRestantes = 0;
      modoLoopAutomatico = false;
      desligarBobinas();
      Serial.println("[PARADO] Motor interrompido e bobinas desligadas.");
      break;

    case '?':
      mostrarConfigAtual();
      mostrarMenu();
      break;

    default:
      Serial.printf("[?] Comando desconhecido: '%s'. Digite '?' para ver a ajuda.\n", cmd.c_str());
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
    } else {
      entradaSerial += c;
    }
  }
}

void setup() {
  Serial.begin(115200);
  delay(400);

  aplicarConfigMotor();
  desligarBobinas();

  Serial.println("\n==========================================================");
  Serial.println("      NETUNO — CALIBRACAO DO ALIMENTADOR (ESP32)          ");
  Serial.println("==========================================================");
  Serial.printf("Pinagem: IN1=%d | IN2=%d | IN3=%d | IN4=%d\n",
                IN1_PIN, IN2_PIN, IN3_PIN, IN4_PIN);

  mostrarConfigAtual();
  mostrarMenu();

  if (girarAoIniciar) {
    iniciarMovimento(passosPorAcionamento, "Giro inicial automatico");
  }
}

void loop() {
  // Lê comandos do Monitor Serial sem travar o motor
  lerSerial();

  // Executa o movimento do motor de passo (precisa rodar o mais rápido possível)
  if (estadoMotor == ESTADO_GIRANDO) {
    mp.run();

    if (mp.distanceToGo() == 0) {
      if (ativarTremidaFinal && tremidaPassos > 0 && tremidaRepeticoes > 0) {
        iniciarTremidinha();
      } else {
        unsigned long duracaoMs = millis() - inicioMovMs;
        estadoMotor = ESTADO_PARADO;
        ultimoFimMovMs = millis();

        if (desligarBobinasAoParar) {
          desligarBobinas();
        }

        Serial.printf("<< [CONCLUIDO] Tempo: %lu ms (%.2f s) | Posicao atual: %ld passos\n",
                      duracaoMs, duracaoMs / 1000.0f, mp.currentPosition());
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
        unsigned long duracaoMs = millis() - inicioMovMs;
        estadoMotor = ESTADO_PARADO;
        ultimoFimMovMs = millis();
        aplicarConfigMotor();

        if (desligarBobinasAoParar) {
          desligarBobinas();
        }

        Serial.printf("<< [CONCLUIDO + TREMIDINHA] Tempo total: %lu ms (%.2f s) | Posicao atual: %ld passos\n",
                      duracaoMs, duracaoMs / 1000.0f, mp.currentPosition());
      }
    }
  } else if (modoLoopAutomatico && (millis() - ultimoFimMovMs >= pausaEntreGirosMs)) {
    iniciarMovimento(passosPorAcionamento, "Loop automatico");
  }
}
