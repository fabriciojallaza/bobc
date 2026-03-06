# 🇧🇴 BOBs — Peso Boliviano Tokenizado con Compliance Regulatorio Onchain

> **Chainlink ACE + CRE | Base (Coinbase L2) | Hackathon MVP**

**BOBs** es un stablecoin ERC-20 pegged 1:1 al Boliviano (BOB), con compliance regulatorio boliviano **enforced onchain** usando Chainlink ACE (mock migrable) y Chainlink CRE como puente fiat-blockchain.

---

## 🔴 El Problema

Bolivia esta en la **lista gris del FATF/GAFI** desde 2020. Esto significa:

- 🏦 **Capital atrapado**: bolivianos no pueden acceder a DeFi ni a servicios financieros globales
- 📋 **Compliance manual**: los bancos bolivianos gastan millones en procesos KYC/AML manuales
- 🚫 **Sin stablecoins locales**: USDT/USDC no resuelven el problema regulatorio boliviano
- ⚖️ **Regulacion estricta**: la UIF (Unidad de Investigaciones Financieras) exige reportes automaticos para transacciones >= Bs 34,500

**No existe un stablecoin que cumpla la regulacion boliviana onchain.** Hasta ahora.

---

## 💡 La Solucion

BOBs tokeniza el Boliviano con **todas las reglas de compliance embedded en smart contracts**, eliminando la necesidad de compliance manual y habilitando acceso a DeFi para bolivianos de forma regulada.

### Flujo Completo

```
                        MINT FLOW
  ┌─────────┐    ┌───────────┐    ┌────────────────┐    ┌───────────────┐
  │  Banco  │───>│ CRE Oracle│───>│ FiatDeposit    │───>│ MinterContract│
  │  (fiat) │    │ (confirm) │    │ Oracle         │    │ (mint BOBs)   │
  └─────────┘    └───────────┘    └────────────────┘    └───────┬───────┘
                                                                │
                                                                v
  ┌─────────┐    ┌───────────┐    ┌────────────────┐    ┌───────────────┐
  │  User   │<───│StablecoinBOB│<──│ PolicyManager  │<───│  CCIDRegistry │
  │ (wallet)│    │ (_update)  │   │ (ACE mock)     │    │  (KYC/CCID)   │
  └─────────┘    └───────────┘    └────────────────┘    └───────────────┘

                       TRANSFER FLOW
  ┌─────────┐  transfer()  ┌───────────────┐  checkTransfer()  ┌───────────────┐
  │ Sender  │─────────────>│ StablecoinBOB │──────────────────>│ PolicyManager │
  │ (KYC'd) │              │  _update hook │                   │ limits/sanctions│
  └─────────┘              └───────┬───────┘                   │ anti-smurfing  │
                                   │                           └───────┬───────┘
                                   v                                   │
                           ┌───────────────┐                           │
                           │  Receiver     │<─── PASS ─────────────────┘
                           │  (KYC'd)      │     or REVERT
                           └───────────────┘

                       REDEEM FLOW
  ┌─────────┐  redeem()  ┌───────────────┐  burn  ┌───────────────┐  CRE  ┌───────┐
  │  User   │───────────>│RedeemContract │──────>│ StablecoinBOB │──────>│ Banco │
  │ (BOBs)  │            │ (compliance)  │       │ (burn tokens) │      │ (fiat) │
  └─────────┘            └───────────────┘       └───────────────┘      └───────┘
```

---

## 🏗️ Stack Tecnologico

| Componente | Tecnologia |
|-----------|------------|
| Smart Contracts | Solidity ^0.8.24 |
| Framework | Foundry (forge, cast, anvil) |
| Blockchain | Base (Coinbase L2) |
| Oracle Fiat | Chainlink CRE (Compute Runtime Environment) |
| Compliance Engine | Chainlink ACE mock (migrable a ACE real) |
| Librerias | OpenZeppelin Contracts v5 (ERC20, AccessControl, Pausable, ReentrancyGuard) |
| AI Agent | Claude MCP (Bank operations) |

---

## 📦 Contratos (6)

| Contrato | Archivo | Rol |
|----------|---------|-----|
| **StablecoinBOB** | `src/StablecoinBOB.sol` | ERC-20 "BOBs" con hook `_update()` que enforces compliance en cada transfer, mint y burn |
| **PolicyManager** | `src/PolicyManager.sol` | Motor de compliance: limites KYC, sanciones, anti-smurfing, reportes UIF. **ACE mock** |
| **CCIDRegistry** | `src/CCIDRegistry.sol` | Registro de identidades cross-chain. Vincula wallets a credenciales KYC con tiers y expiracion |
| **MinterContract** | `src/MinterContract.sol` | Mintea BOBs tras confirmacion del CRE oracle. Valida CCID, reservas, limites, anti-double-mint |
| **RedeemContract** | `src/RedeemContract.sol` | Burn de BOBs + solicitud de transferencia bancaria. Compliance check + reporte UIF automatico |
| **FiatDepositOracle** | `src/FiatDepositOracle.sol` | Oracle CRE mock: confirma depositos fiat, trackea reservas, previene depositos duplicados |

---

## 🇧🇴 Reglas de Negocio Bolivia

### KYC Tiers y Limites Diarios

| Tier | Descripcion | Limite Diario | Ejemplo |
|------|------------|---------------|---------|
| **KYC1** | Persona natural, CI verificada | **Bs 5,000** | Remesas, pagos cotidianos |
| **KYC2** | Persona con verificacion reforzada | **Bs 34,000** | Comerciantes, freelancers |
| **KYC3** | Empresa con vLEI | **Bs 500,000** | Importadores, corporativos |

### Controles Anti-Lavado

| Regla | Parametro | Descripcion |
|-------|-----------|-------------|
| 🚨 **Umbral UIF** | `>= Bs 34,500` | Reporte automatico via evento `UIFReport` a la Unidad de Investigaciones Financieras |
| 🛡️ **Anti-Smurfing** | `5 tx/hora` | Al alcanzar 5 transacciones en una hora, se activa cooldown automatico |
| ⏳ **Cooldown** | `2 horas` | Periodo de bloqueo tras activacion anti-smurfing |
| 🔒 **Sanciones** | OFAC + UIF | Wallets sancionadas no pueden enviar, recibir, mintear ni redimir |
| ❄️ **Freeze** | Admin | Congelamiento de wallets por orden judicial o investigacion |
| 📅 **CCID Expiracion** | `365 dias` | Identidades expiran anualmente, requieren renovacion |
| 🏭 **Max Mint** | `Bs 500,000` | Limite por operacion de minteo individual |
| ⏰ **Deposit Validity** | `24 horas` | Depositos fiat confirmados deben mintearse dentro de 24h |
| 💰 **Min Redeem** | `Bs 100` | Monto minimo para redenciones |

---

## 🔗 Integracion ACE (Chainlink)

**PolicyManager** y **CCIDRegistry** son **mocks compatibles** con la interfaz de Chainlink ACE. Esto permite:

1. **Hoy (MVP)**: compliance enforcement via contratos propios
2. **Manana (Produccion)**: migracion a ACE real sin cambiar StablecoinBOB

### Migracion a ACE Real

```
StablecoinBOB.updateCompliance(aceRealAddress)
    │
    ├── ⏳ Timelock: 48 horas de espera obligatoria
    │
    └── StablecoinBOB.executePolicyManagerUpdate()
         └── policyManager = ACE real ✅
```

El **timelock de 48 horas** protege contra cambios maliciosos: la comunidad tiene 2 dias para auditar cualquier cambio de compliance engine.

> 📄 Guia completa: [`docs/ACE_INTEGRATION_GUIDE.md`](docs/ACE_INTEGRATION_GUIDE.md)

---

## 🌐 Integracion CRE (Chainlink)

El Chainlink CRE (Compute Runtime Environment) actua como **puente entre el sistema bancario boliviano y la blockchain**.

### 3 Jobs del CRE

| Job | Trigger | Accion |
|-----|---------|--------|
| **FiatDepositConfirmation** | Deposito bancario detectado | Confirma deposito en `FiatDepositOracle` → habilita mint |
| **ProofOfReserves** | Cada 24h | Actualiza `totalReserves` en el oracle → garantiza colateral 1:1 |
| **RedeemExecution** | Evento `RedeemRequested` | Ejecuta transferencia bancaria al usuario → confirma onchain |

> 📄 Especificacion completa: [`docs/CRE_SPEC.md`](docs/CRE_SPEC.md)

---

## 🤖 Bank Agent MCP

Un agente AI (Claude) opera como **administrador del dia a dia** del sistema via MCP (Model Context Protocol):

- 🪪 **Gestion de identidades**: registra/revoca CCIDs, asigna tiers KYC
- ❄️ **Freeze/Unfreeze**: congela wallets por orden judicial
- 🚫 **Sanciones**: agrega/remueve wallets de la lista OFAC+UIF
- 📊 **Monitoreo**: supervisa depositos, redenciones, alertas UIF
- 🏦 **Bank operations**: linkea cuentas bancarias, confirma redenciones

> 📄 Especificacion completa: [`docs/BANK_MCP_SPEC.md`](docs/BANK_MCP_SPEC.md)

---

## 🚀 Quick Start

### Prerrequisitos

- [Foundry](https://book.getfoundry.sh/getting-started/installation) instalado

### Instalacion

```bash
git clone <repo-url>
cd ACE
forge install
```

### Compilar

```bash
forge build
```

### Tests

```bash
forge test -vvv
```

### Deploy (Base Sepolia)

```bash
# Configurar variables de entorno
export PRIVATE_KEY=<tu-private-key>
export RPC_URL=<base-sepolia-rpc-url>

# Deploy completo
forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast --private-key $PRIVATE_KEY
```

---

## ✅ Tests

```
55 tests, 0 failures
```

### Cobertura por Contrato

| Suite | Tests | Cobertura |
|-------|-------|-----------|
| `CCIDRegistry.t.sol` | Registro, revocacion, expiracion, credential unico, tiers | Identidad completa |
| `PolicyManager.t.sol` | Limites KYC1/2/3, sanciones, freeze, cooldown, anti-smurfing, UIF | Compliance completa |
| `StablecoinBOB.t.sol` | Mint, burn, transfer con compliance hooks, timelock, pause | Token + hooks |
| `MinterContract.t.sol` | Mint valido, doble-mint, deposit expirado, reservas insuficientes, CCID invalido | Mint flow |
| `RedeemContract.t.sol` | Redeem valido, minimo, sin banco, UIF report, force redeem | Redeem flow |
| `Integration.t.sol` | Flujo completo mint-transfer-redeem, multi-tier, escenarios edge | End-to-end |

---

## 🗺️ Roadmap v2

| Feature | Descripcion | Prioridad |
|---------|------------|-----------|
| 🔗 **CCIP Cross-Chain** | Transferencias BOBs entre Base, Ethereum, Arbitrum via Chainlink CCIP | Alta |
| 🏛️ **ACE Real** | Migracion de PolicyManager mock a Chainlink ACE production | Alta |
| 👥 **Multisig** | Governance via Safe multisig para operaciones admin criticas | Media |
| 🇧🇴 **Jurisdiccion (TX-6)** | Validacion de jurisdiccion boliviana en identidades CCID | Media |
| 📊 **Dashboard** | Panel de monitoreo para UIF, volumes, alertas en tiempo real | Baja |
| 🏦 **Multi-banco** | Soporte para multiples bancos custodios con failover | Baja |

---

## 📐 Arquitectura de Seguridad

- 🔐 **ReentrancyGuard** en todas las operaciones de mint/burn/redeem
- 🎭 **AccessControl** con roles granulares (ADMIN, MINTER, ORACLE, OPERATOR, REGISTRAR)
- ⏳ **Timelock 48h** en todos los cambios de contratos criticos (oracle, policyManager, ccidRegistry)
- ⏸️ **Pausable** global para emergencias
- 🚫 **Anti-double-mint**: depositos marcados como `used` tras mint
- 📊 **Proof of Reserves**: mint bloqueado si reservas insuficientes o stale (>24h)
- 🏦 **Bank License**: kill switch para detener todo minteo

---

## 📄 Documentacion

| Documento | Descripcion |
|-----------|-------------|
| [`docs/CRE_SPEC.md`](docs/CRE_SPEC.md) | Especificacion del Chainlink CRE Oracle (3 jobs) |
| [`docs/BANK_MCP_SPEC.md`](docs/BANK_MCP_SPEC.md) | Especificacion del Bank Agent MCP (Claude AI) |
| [`docs/ACE_INTEGRATION_GUIDE.md`](docs/ACE_INTEGRATION_GUIDE.md) | Guia de integracion con Chainlink ACE |
| [`docs/VALIDATION_REPORT.md`](docs/VALIDATION_REPORT.md) | Reporte de validacion: 26 PASS, 4 PARCIAL, 1 FAIL |

---

## 🏆 Por que BOBs?

1. **Production-ready architecture**: no es un demo, es un MVP desplegable con compliance real
2. **Regulacion boliviana onchain**: primer stablecoin que implementa reglas UIF/FATF en smart contracts
3. **Chainlink-native**: ACE para compliance, CRE para oracle fiat, CCIP-ready para cross-chain
4. **AI-operated**: agente Claude gestiona operaciones bancarias via MCP
5. **Upgrade path claro**: mock → ACE real sin cambiar la logica del token

---

<p align="center">
  <b>Built for Chainlink Hackathon 2026</b><br>
  <i>Bringing Bolivia onchain, compliantly. 🇧🇴</i>
</p>
