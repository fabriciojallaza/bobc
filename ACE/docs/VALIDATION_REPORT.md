# Validation Report -- BOB Stablecoin

**Fecha:** 2026-03-04
**Validador:** Agente Validador (Task #3)
**Estado General:** APROBADO MVP

---

## Resumen Ejecutivo

De 31 reglas de negocio evaluadas: **26 PASS, 4 PARCIAL, 1 FAIL**.
Se identificaron **0 issues criticos** de seguridad, **2 medios** y **3 bajos**.
El sistema MVP es funcional. Los 2 issues criticos y 2 medios de la primera ronda fueron resueltos.
La unica regla FAIL restante (TX-6 jurisdiccion) es un gap aceptable para MVP.

---

## 1. Reglas de Negocio

### Identidad (CCID)

| Regla | Descripcion | Estado | Notas |
|-------|------------|--------|-------|
| ID-1 | Solo wallets con CCID valido pueden recibir/enviar | PASS | `PolicyManager.checkTransfer()` valida `ccidRegistry.isValid()` para from y to. `_update()` en StablecoinBOB invoca checkTransfer/checkMint/checkRedeem. |
| ID-2 | CCID expira 12 meses | PASS | `CCIDRegistry.IDENTITY_DURATION = 365 days`. `isValid()` verifica `expiresAt > block.timestamp`. |
| ID-3 | Sanctions list (OFAC + UIF) | PASS | `PolicyManager.sanctionsList` mapping, verificado en checkTransfer, checkMint, checkRedeem. Funciones addToSanctions/removeFromSanctions con DEFAULT_ADMIN_ROLE. |
| ID-4 | 1 credential = 1 wallet activa | PASS | `CCIDRegistry._credentialToWallet` mapping. `registerIdentity()` verifica `CredentialAlreadyUsed` si el credentialHash ya esta asignado a una wallet activa. |
| ID-5 | Empresas requieren vLEI (KYC3) | PARCIAL | KYC3 tier existe en el enum pero no hay validacion explicita de que empresas DEBEN tener KYC3. Es responsabilidad off-chain del registrar. |

### Mint

| Regla | Descripcion | Estado | Notas |
|-------|------------|--------|-------|
| MINT-1 | Solo mintear con confirmacion CRE | PASS | `MinterContract.mint()` requiere deposit de `FiatDepositOracle` con `confirmedAt != 0`. Solo ORACLE_ROLE puede llamar `confirmDeposit()`. |
| MINT-2 | txId unico (anti-double-mint) | PASS | `FiatDepositOracle.usedTxIds` mapping + `MinterContract` verifica `deposit.used` y llama `markUsed()`. |
| MINT-3 | Wallet destino con CCID valido pre-mint | PASS | `MinterContract.mint()` linea 51: `ccidRegistry.isValid(deposit.user)`. Ademas `StablecoinBOB._update()` invoca `policyManager.checkMint()` que tambien valida CCID. |
| MINT-4 | 1:1 BOB | PASS | `MinterContract.mint()` usa `deposit.amount` directamente para `token.mint()`. Sin conversion de ratio. |
| MINT-5 | Max 500k BOB por mint | PASS | `MinterContract.MAX_SINGLE_MINT = 500_000 * 1e18`. Verificado en linea 52. |
| MINT-6 | Timeout 24h entre deposito y mint | PASS | `DEPOSIT_VALIDITY = 24 hours`. `deposit.confirmedAt + DEPOSIT_VALIDITY < block.timestamp` expira depositos despues de 24h. Interpretacion: deposito valido por ventana de 24h. Aceptado. |

### Transferencias

| Regla | Descripcion | Estado | Notas |
|-------|------------|--------|-------|
| TX-1 | Ambas wallets con CCID | PASS | `PolicyManager.checkTransfer()` linea 64: valida `isValid(from)` e `isValid(to)`. |
| TX-2 | Limites diarios por tier | PASS | `PolicyManager._getDailyLimit()` retorna KYC1=5k, KYC2=34k, KYC3=500k. `dailyVolume` acumulado por dia. |
| TX-3 | Flag UIF si >= 34,500 BOB | PASS | `PolicyManager.recordTransfer()` linea 91: `if (amount >= uifThreshold)` emite `UIFReport`. Threshold configurado en 34,500 * 1e18. |
| TX-4 | Anti-smurfing: 5 tx/hora -> cooldown 2h | PASS | `PolicyManager.recordTransfer()` lineas 83-89: cuenta txs por hora, activa cooldown de 2h al llegar a 5. `checkTransfer()` verifica cooldown. |
| TX-5 | Wallets sin CCID bloqueadas | PASS | Implicito en TX-1: `checkTransfer()` revierte con `InvalidCCID` si alguna wallet no tiene CCID valido. |
| TX-6 | Jurisdiccion boliviana | FAIL | No hay validacion de jurisdiccion en ningun contrato. No hay campo de jurisdiccion en la Identity struct. |

### Redeem

| Regla | Descripcion | Estado | Notas |
|-------|------------|--------|-------|
| RED-1 | Minimo 100 BOB | PASS | `RedeemContract.MIN_REDEEM = 100 * 1e18`. Verificado en linea 67. |
| RED-2 | Quema tokens ANTES de iniciar transferencia | PASS | `RedeemContract.redeem()` llama `token.burnFrom()` (linea 77) antes de emitir `RedeemRequested` (linea 79). |
| RED-3 | CRE tiene 48h (evento emitido correctamente) | PARCIAL | El evento `RedeemRequested` se emite correctamente. Sin embargo, no hay enforcement on-chain de las 48h. El evento permite al CRE off-chain rastrear el deadline. |
| RED-4 | Redeem >= 34,500 -> reporte UIF | PASS | `RedeemContract.redeem()` linea 81: emite `UIFRedeemReport` si amount >= UIF_THRESHOLD. |
| RED-5 | Cuenta bancaria vinculada al CCID | PASS | `RedeemContract.bankAccountByWallet` mapping. `redeem()` linea 69: revierte con `NoBankAccount` si no hay cuenta vinculada. |

### Banco

| Regla | Descripcion | Estado | Notas |
|-------|------------|--------|-------|
| BCO-1 | Proof of reserves cada 24h | PASS | `FiatDepositOracle.isReservesStale()` verifica si `lastReservesUpdate + 24h < now`. `MinterContract.mint()` revierte con `ReservesStale` si es stale. |
| BCO-2 | Si reservas < supply -> mint pausado | PASS | `MinterContract.mint()` linea 54: `oracle.getTotalReserves() < token.totalSupply() + deposit.amount` revierte con `InsufficientReserves`. |
| BCO-3 | vLEI para banco | PARCIAL | No hay validacion on-chain de vLEI del banco. El banco es representado por roles (ORACLE_ROLE). Aceptable para MVP. |
| BCO-4 | Si banco pierde licencia -> modo emergencia | PASS | `MinterContract.bankLicenseRevoked` bool. `mint()` revierte con `BankLicenseIsRevoked` si activo. `revokeBankLicense()` y `restoreBankLicense()` con DEFAULT_ADMIN_ROLE y eventos. |

### Emergencia

| Regla | Descripcion | Estado | Notas |
|-------|------------|--------|-------|
| EMR-1 | Freeze wallet individual | PASS | `PolicyManager.freezeWallet()` con DEFAULT_ADMIN_ROLE. Verificado en checkTransfer y checkRedeem. |
| EMR-2 | Pause global | PASS | `StablecoinBOB.pause()` usa OpenZeppelin Pausable. `_update()` tiene `whenNotPaused`. Ademas `PolicyManager.paused` flag verificado en todos los checks. |
| EMR-3 | Force redeem de wallet bloqueada | PASS | `RedeemContract.forceRedeem(wallet, amount)` con DEFAULT_ADMIN_ROLE. Verifica balance y bankAccount. Llama `token.burnByMinter()`. `StablecoinBOB.burnByMinter()` con MINTER_ROLE. Evento `ForceRedeemExecuted`. |
| EMR-4 | Reporte historial UIF | PARCIAL | Los eventos UIFReport y UIFRedeemReport se emiten, pero no hay funcion on-chain para consultar historial. El historial se puede reconstruir via event logs off-chain. Aceptable para MVP. |
| EMR-5 | Timelock 48h para cambios criticos | PASS | Timelock 48h implementado en: StablecoinBOB (`updateCompliance`/`executePolicyManagerUpdate`), MinterContract (oracle y CCIDRegistry), RedeemContract (policyManager y CCIDRegistry). Patron: queue + 48h delay + execute. Eventos de queue y ejecucion. |

---

## 2. Seguridad

### Critico

No hay issues criticos pendientes. Los 2 criticos de la primera ronda fueron resueltos (ver Segunda Ronda).

### Medio

| # | Issue | Ubicacion | Descripcion |
|---|-------|-----------|-------------|
| S-4 | **Front-running en mint** | MinterContract.sol:63 | `mint()` es callable solo por ORACLE_ROLE, lo que mitiga front-running externo. Sin embargo, no hay proteccion si el oracle operator intenta reordenar transacciones. Riesgo bajo dado que es un rol de confianza. |
| S-5 | **Cooldown solo en from, no en to** | PolicyManager.sol:86 | Anti-smurfing solo cuenta transacciones del sender. Un receptor podria recibir transacciones ilimitadas de diferentes wallets sin activar cooldown. |

### Bajo

| # | Issue | Ubicacion | Descripcion |
|---|-------|-----------|-------------|
| S-7 | **checkTransfer usa revert en vez de return false** | PolicyManager.sol:60-64 | La interfaz IPolicyManager define retorno `(bool, string)`, pero las funciones check* usan `revert` para errores custom. Esto significa que el retorno `(false, reason)` nunca se usa -- siempre revierte. `StablecoinBOB._update()` verifica `if (!allowed)` que nunca sera false porque ya revertio. No es un bug funcional pero la interfaz es misleading. |
| S-8 | **Reentrancy en StablecoinBOB** | StablecoinBOB.sol:12 | Importa ReentrancyGuard pero NUNCA usa `nonReentrant`. Las funciones mint(), burn(), burnFrom() no tienen el modifier. El guard de reentrancy es efectivamente inutil en este contrato. |
| S-9 | **Nonce predictable en RedeemContract** | RedeemContract.sol:74 | `redeemId` se genera con `keccak256(msg.sender, amount, timestamp, nonce)`. El nonce es un simple counter, lo que hace el redeemId predecible. No es explotable directamente pero podria ser problema si se usa como entropy. |

---

## 3. Calidad de Codigo

| Item | Estado | Notas |
|------|--------|-------|
| NatDoc en funciones publicas | PASS | Todas las funciones publicas tienen `@notice` y `@param`. Usa `@inheritdoc` donde aplica. |
| Sin codigo comentado o TODOs | PASS | No se encontraron TODOs ni codigo comentado. |
| Consistencia entre interfaces e implementaciones | PASS | Todas las implementaciones cumplen con sus interfaces. |
| updateCompliance() setter para migrar a ACE real | PASS | `StablecoinBOB.updateCompliance()` + `executePolicyManagerUpdate()` con timelock 48h. Habilita migracion segura a un compliance manager real. |
| Errores custom | PARCIAL | La mayoria de contratos usan errores custom (CCIDRegistry, PolicyManager, etc.). Sin embargo, PolicyManager revierte con errores custom cuando la interfaz sugiere retornar `(false, reason)` con strings. Inconsistencia de diseno. |
| Eventos para operaciones importantes | PASS | Todas las operaciones admin emiten eventos: `PausedStateChanged`, `UifThresholdUpdated`, `PolicyManagerUpdateQueued`, `PolicyManagerUpdated`, etc. |

---

## 4. ACE Integration

| Item | Estado | Notas |
|------|--------|-------|
| CCT Compliance Extension hookeada en _update | PASS | `StablecoinBOB._update()` invoca PolicyManager para transfers, mints y burns. Patron correcto de OZ v5. |
| PolicyManager invocado en mint, transfer Y burn | PASS | Transfer: checkTransfer + recordTransfer. Mint: checkMint. Burn: checkRedeem. Todos invocados desde `_update()`. |
| CCID validado antes de cada operacion relevante | PASS | PolicyManager.check* funciones validan CCID via ccidRegistry.isValid(). MinterContract tambien valida directamente. |
| Eventos emitidos para auditoria UIF | PASS | UIFReport en transfers, UIFRedeemReport en redeems. Threshold configurable. |

---

## 5. Gaps MVP vs Produccion

| Gap | Prioridad | Estado |
|-----|-----------|--------|
| ~~Timelock~~ | ~~CRITICA~~ | RESUELTO -- Timelock 48h implementado en todos los contratos. |
| ~~Force Redeem (EMR-3)~~ | ~~ALTA~~ | RESUELTO -- `forceRedeem()` en RedeemContract + `burnByMinter()` en StablecoinBOB. |
| Jurisdiccion (TX-6) | MEDIA | PENDIENTE -- Gap aceptable para MVP. No hay validacion de jurisdiccion on-chain. |
| ~~Modo Emergencia Banco (BCO-4)~~ | ~~MEDIA~~ | RESUELTO -- `bankLicenseRevoked` en MinterContract bloquea mints. |
| ~~recordTransfer en burns~~ | ~~MEDIA~~ | RESUELTO -- `_update()` ahora llama recordTransfer para burns. |
| Reentrancy guard en StablecoinBOB | BAJA | PENDIENTE -- ReentrancyGuard importado pero no usado con nonReentrant. |
| ~~Eventos para cambios admin~~ | ~~BAJA~~ | RESUELTO -- Eventos agregados en setPaused y setUifThreshold. |
| ~~Verificacion return de checkRedeem~~ | ~~BAJA~~ | RESUELTO -- Retorno verificado en RedeemContract.redeem(). |
| Multisig | PRODUCCION | PENDIENTE -- DEFAULT_ADMIN_ROLE debe ser multisig en produccion. |
| Upgradability | PRODUCCION | PENDIENTE -- Considerar proxy pattern para upgrades. |

---

## 6. Recomendaciones Pendientes (post segunda ronda)

1. **[MEDIA] Resolver inconsistencia revert vs return**: PolicyManager usa reverts para errores pero la interfaz sugiere retornar `(false, reason)`. Decidir un patron unico.

2. **[BAJA] Limpiar ReentrancyGuard en StablecoinBOB**: Importa ReentrancyGuard pero no usa `nonReentrant` en ninguna funcion. Agregar o remover.

3. **[PRODUCCION] Multisig**: DEFAULT_ADMIN_ROLE debe ser un Gnosis Safe multisig en produccion.

4. **[PRODUCCION] Upgradability**: Considerar UUPS o TransparentProxy para upgrades sin redeploy.

5. **[DEPLOYMENT] Configurar MINTER_ROLE**: RedeemContract necesita MINTER_ROLE en StablecoinBOB para que `forceRedeem` -> `burnByMinter` funcione.

---

## Resumen Numerico

| Categoria | Total | Pass | Parcial | Fail |
|-----------|-------|------|---------|------|
| Identidad | 5 | 4 | 1 | 0 |
| Mint | 6 | 6 | 0 | 0 |
| Transferencias | 6 | 5 | 0 | 1 |
| Redeem | 5 | 4 | 1 | 0 |
| Banco | 4 | 3 | 1 | 0 |
| Emergencia | 5 | 4 | 1 | 0 |
| **Total** | **31** | **26** | **4** | **1** |

| Seguridad | Cantidad |
|-----------|----------|
| Critico | 0 |
| Medio | 2 |
| Bajo | 3 |

---

## Segunda Ronda -- Post-Fix Validation

**Fecha:** 2026-03-04
**Validador:** Agente Validador (Ronda 2)

### Fix 1 -- Timelock 48h (S-1 / EMR-5) -- VERIFICADO

- **StablecoinBOB.sol**: `updateCompliance()` (L78) guarda `pendingPolicyManager` y `pendingPolicyManagerTime = block.timestamp + 48 hours`. `executePolicyManagerUpdate()` (L85) verifica `block.timestamp >= pendingPolicyManagerTime`. Eventos `PolicyManagerUpdateQueued` y `PolicyManagerUpdated` emitidos. Limpia pending despues de ejecutar.
- **MinterContract.sol**: Mismo patron para oracle (`updateOracle`/`executeOracleUpdate`, L96-113) y CCIDRegistry (`updateCCIDRegistry`/`executeCCIDRegistryUpdate`, L117-134). Eventos correspondientes emitidos.
- **RedeemContract.sol**: Mismo patron para policyManager (L127-144) y CCIDRegistry (L148-165). Eventos correspondientes emitidos.
- **Resultado**: VERIFICADO

### Fix 2 -- checkRedeem() retorno (S-2) -- VERIFICADO

- **RedeemContract.sol** L87-88: `(bool allowed, string memory reason) = policyManager.checkRedeem(msg.sender, amount); if (!allowed) revert ComplianceViolation(reason);`
- El retorno ahora se captura y se verifica correctamente.
- **Resultado**: VERIFICADO

### Fix 3 -- recordTransfer en burns (S-3) -- VERIFICADO

- **StablecoinBOB.sol** L115-118: Cuando `to == address(0)`, ahora se llama `policyManager.checkRedeem(from, value)` Y `policyManager.recordTransfer(from, address(0), value)`.
- Burns ahora cuentan para volumen diario y anti-smurfing.
- **Resultado**: VERIFICADO

### Fix 4 -- Eventos en setters admin (S-6) -- VERIFICADO

- **PolicyManager.sol** L170-173: `setUifThreshold()` emite `UifThresholdUpdated(oldThreshold, _threshold)`.
- **PolicyManager.sol** L164-165: `setPaused()` emite `PausedStateChanged(_paused)`.
- Eventos declarados en L26-27.
- **Resultado**: VERIFICADO

### Fix 5 -- Force redeem EMR-3 -- VERIFICADO

- **RedeemContract.sol** L114-123: `forceRedeem(address wallet, uint256 amount)` con `onlyRole(DEFAULT_ADMIN_ROLE)` y `nonReentrant`. Verifica `token.balanceOf(wallet) < amount` (InsufficientBalance). Verifica bankAccount no vacio (NoBankAccount). Llama `token.burnByMinter(wallet, amount)`. Emite `ForceRedeemExecuted`.
- **StablecoinBOB.sol** L62-64: `burnByMinter(address from, uint256 amount)` con `onlyRole(MINTER_ROLE)`. Llama `_burn(from, amount)`.
- **Nota**: RedeemContract necesita tener MINTER_ROLE en StablecoinBOB para que `burnByMinter` funcione. Esto debe configurarse en deployment.
- **Resultado**: VERIFICADO

### Fix 6 -- Bank license BCO-4 -- VERIFICADO

- **MinterContract.sol** L40: `bool public bankLicenseRevoked;`
- **MinterContract.sol** L64: `if (bankLicenseRevoked) revert BankLicenseIsRevoked();` como primer check en `mint()`.
- **MinterContract.sol** L83-92: `revokeBankLicense()` y `restoreBankLicense()` con `onlyRole(DEFAULT_ADMIN_ROLE)`. Emiten `BankLicenseRevoked` y `BankLicenseRestored` con timestamp.
- **Resultado**: VERIFICADO

### Fix 7 -- MINT-6 timeout -- VERIFICADO

- **MinterContract.sol** L70: `if (deposit.confirmedAt + DEPOSIT_VALIDITY < block.timestamp) revert DepositExpired();` donde `DEPOSIT_VALIDITY = 24 hours`.
- Logica correcta: deposito valido por ventana de 24h despues de confirmacion. Interpretacion aceptada como "ventana de validez" para MVP.
- **Resultado**: VERIFICADO

### Resumen de Issues Previos

| Issue | Ronda 1 | Ronda 2 | Estado |
|-------|---------|---------|--------|
| S-1 Timelock (CRITICO) | FAIL | VERIFICADO | RESUELTO |
| S-2 checkRedeem retorno (CRITICO) | FAIL | VERIFICADO | RESUELTO |
| S-3 recordTransfer en burns (MEDIO) | FAIL | VERIFICADO | RESUELTO |
| S-6 Eventos setters admin (MEDIO) | FAIL | VERIFICADO | RESUELTO |
| EMR-3 Force redeem | FAIL | VERIFICADO | RESUELTO |
| EMR-5 Timelock | FAIL | VERIFICADO | RESUELTO |
| BCO-4 Bank license | FAIL | VERIFICADO | RESUELTO |
| MINT-6 Timeout | FAIL -> PASS | VERIFICADO | RESUELTO |
| TX-6 Jurisdiccion | FAIL | N/A | GAP ACEPTABLE MVP |

### Nuevos Issues Introducidos por Fixes

No se detectaron nuevos issues de seguridad introducidos por los fixes. La implementacion es limpia y consistente.

**Nota sobre deployment**: El `forceRedeem()` en RedeemContract requiere que el contrato RedeemContract tenga `MINTER_ROLE` en StablecoinBOB para poder llamar `burnByMinter()`. Esto debe configurarse correctamente en el script de deployment.
