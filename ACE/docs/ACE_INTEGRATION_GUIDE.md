# ACE Integration Guide — MVP vs Production

## 1. Lo que implementamos como mock en el MVP

El MVP de BOB Stablecoin implementa mocks de tres componentes que en produccion seran reemplazados por Chainlink ACE (Automated Compliance Engine):

| Componente MVP (Mock) | Componente ACE Real | Proposito |
|----------------------|---------------------|-----------|
| `CCIDRegistry.sol` | Chainlink CCID (Cross-Chain Identity) | Registro de identidades verificadas |
| `PolicyManager.sol` | ACE Policy Manager | Motor de reglas de compliance |
| `FiatDepositOracle.sol` | Chainlink CRE (ya es real) | Oracle para datos fiat |

### CCIDRegistry.sol (Mock de CCID)

Nuestro mock implementa un registro simple de identidades:

```solidity
// Mock simplificado
mapping(address => bool) public hasIdentity;
mapping(string => address) public userIdToWallet;

function registerIdentity(address user, string calldata userId) external onlyAdmin;
function revokeIdentity(address user) external onlyAdmin;
```

**Limitaciones del mock vs CCID real:**
- No es cross-chain (solo funciona en Base)
- No es portable (el usuario no puede llevar su identidad a otra chain)
- Gestionado por nuestro admin (no por Chainlink)
- No tiene integracion con proveedores de identidad reales

### PolicyManager.sol (Mock de ACE Policy Manager)

Nuestro mock implementa reglas de compliance en Solidity:

```solidity
// Mock simplificado
function checkTransfer(address from, address to, uint256 amount) external view returns (bool);
function checkMint(address to, uint256 amount) external view returns (bool);
function checkBurn(address from, uint256 amount) external view returns (bool);
```

**Limitaciones del mock vs ACE real:**
- Reglas hardcoded en Solidity (requiere redeploy para cambiar)
- Sin UI visual para gestionar reglas
- Sin templates de compliance pre-construidos
- Sin integracion con bases de datos de sanciones

### FiatDepositOracle.sol (Interfaz CRE)

Este contrato **no es un mock** — es la interfaz real que el CRE usa. Se mantiene igual en produccion. El CRE es un componente de Chainlink que ya esta disponible.

---

## 2. Como migrar a ACE real

### Paso 1: Migrar CCIDRegistry → Chainlink CCID

Cuando Chainlink CCID este disponible en Base:

1. **Desplegar o conectar** al contrato CCID de Chainlink en Base
2. **Migrar identidades** existentes del CCIDRegistry mock al CCID real
3. **Actualizar StablecoinBOB.sol**:

```solidity
// Antes (mock):
CCIDRegistry public ccidRegistry;

// Despues (CCID real):
IChainlinkCCID public ccid; // Interfaz de Chainlink CCID
```

4. **Actualizar la referencia** en el constructor o via setter:

```solidity
function updateCCIDProvider(address newCCID) external onlyAdmin {
    ccid = IChainlinkCCID(newCCID);
}
```

5. **Verificar** que las funciones de consulta sean compatibles:
   - `hasCCID(userId)` → `ccid.hasIdentity(userId)` (el nombre puede variar)
   - `getWallet(userId)` → `ccid.resolveWallet(userId)` (el nombre puede variar)

### Paso 2: Migrar PolicyManager → ACE Policy Manager

1. **Registrar el token** en la plataforma ACE de Chainlink
2. **Configurar reglas** de compliance usando la UI visual de ACE:
   - Reglas AML/KYC
   - Limites de transaccion
   - Listas de sanciones
   - Reglas de jurisdiccion
3. **Obtener la address** del Policy Manager asignado por ACE
4. **Actualizar StablecoinBOB.sol**:

```solidity
// Antes (mock):
PolicyManager public policyManager;

// Despues (ACE real):
IACEPolicyManager public policyManager; // Interfaz ACE
```

5. **Actualizar la referencia**:

```solidity
function updatePolicyManager(address newPolicyManager) external onlyAdmin {
    policyManager = IACEPolicyManager(newPolicyManager);
}
```

### Paso 3: Verificar integracion

- [ ] Ejecutar test de mint con usuario registrado en CCID real
- [ ] Ejecutar test de transfer entre usuarios con compliance aprobado
- [ ] Ejecutar test de transfer con usuario no verificado (debe fallar)
- [ ] Ejecutar test de transfer que viole reglas AML (debe fallar)
- [ ] Verificar que CRE sigue funcionando sin cambios
- [ ] Verificar que MinterContract y RedeemContract no requieren cambios

---

## 3. Que se mantiene igual

Los siguientes contratos **no cambian** al migrar a ACE real:

### StablecoinBOB.sol (ERC-20 core)

El token solo necesita actualizar las **direcciones** de PolicyManager y CCIDRegistry. La logica del ERC-20, los compliance hooks (`_beforeTokenTransfer`), y la interfaz publica se mantienen identicos.

```solidity
// Los hooks siguen llamando a la misma interfaz:
function _beforeTokenTransfer(address from, address to, uint256 amount) internal {
    require(policyManager.checkTransfer(from, to, amount), "Transfer blocked by policy");
}
```

Solo cambia **a quien** le pregunta, no **que** pregunta.

### MinterContract.sol

La logica de mint no cambia:
- Sigue leyendo datos de FiatDepositOracle
- Sigue minteando via StablecoinBOB.mint()
- Los compliance checks se ejecutan automaticamente via los hooks del token

### RedeemContract.sol

La logica de redeem no cambia:
- Sigue quemando tokens via StablecoinBOB.burn()
- Sigue emitiendo RedeemRequested
- Sigue recibiendo confirmRedeemExecuted del CRE

### CRE Jobs

Los 3 jobs del CRE (FiatDepositConfirmation, ProofOfReserves, RedeemExecution) **no cambian**. El CRE interactua con FiatDepositOracle, MinterContract, y RedeemContract — ninguno de estos contratos se modifica en la migracion a ACE.

---

## 4. Diferencias clave mock vs ACE real

### CCID: Mock vs Real

| Aspecto | Mock (CCIDRegistry) | ACE Real (Chainlink CCID) |
|---------|---------------------|---------------------------|
| **Scope** | Solo Base | Cross-chain (Base, Ethereum, Arbitrum, etc.) |
| **Gestion** | Admin del proyecto | Chainlink + usuario |
| **Portabilidad** | No portable | Usuario lleva su identidad entre chains |
| **Verificacion** | Manual (admin registra) | Integrado con proveedores KYC |
| **Privacidad** | Datos onchain | ZK proofs, datos offchain |
| **Revocacion** | Solo admin | Admin + mecanismos automaticos |

### Policy Manager: Mock vs Real

| Aspecto | Mock (PolicyManager) | ACE Real (Policy Manager) |
|---------|---------------------|---------------------------|
| **Configuracion** | Solidity hardcoded | UI visual, no-code |
| **Templates** | No tiene | Templates pre-construidos (AML, KYC, sanciones) |
| **Actualizacion** | Redeploy del contrato | Cambios en tiempo real via UI |
| **Listas de sanciones** | Manual | Integrado con OFAC, EU, UN |
| **Reportes** | Manual | Dashboard automatico |
| **Auditoria** | Logs basicos | Trail de auditoria completo |

### Integracion con vLEI (GLEIF)

ACE real incluye integracion con vLEI (verifiable Legal Entity Identifier) de GLEIF:

- **Que es**: Identificador verificable de entidades legales
- **Para que sirve**: Verificar que el emisor del token (la empresa) es una entidad legal real
- **En el MVP**: No implementado (no es necesario para testnet)
- **En produccion**: La entidad emisora del BOB Stablecoin tendra un vLEI que ACE puede verificar

---

## 5. Links y recursos

### Chainlink ACE

| Recurso | URL |
|---------|-----|
| ACE Early Access | https://chain.link/automated-compliance-engine |
| ACE Overview | https://chain.link/education/automated-compliance-engine |

### Standards relacionados

| Standard | Descripcion | Relevancia |
|----------|-------------|------------|
| ERC-3643 | Token permissioned (T-REX) | Alternativa mas avanzada para tokens regulados. ACE es compatible con ERC-3643 y puede ser una opcion si se requieren mas funcionalidades de compliance. |
| vLEI | Verifiable Legal Entity Identifier | Identificacion de la entidad emisora. Integrado en ACE. |
| ERC-20 | Token estandar | Base de StablecoinBOB. Compatible con ACE. |

### Chainlink

| Componente | Descripcion |
|-----------|-------------|
| CRE (Compute Runtime Environment) | Runtime para logica offchain. Ya disponible. |
| CCID (Cross-Chain Identity) | Identidad cross-chain. Parte de ACE. |
| Automation | Triggers basados en tiempo o condiciones. Usado para ProofOfReserves. |
| Data Feeds | Feeds de precios. No usado directamente (BOB Stablecoin usa oracle propio). |

### Contacto y Early Access

Para acceso anticipado a ACE y soporte tecnico:
1. Aplicar en https://chain.link/automated-compliance-engine
2. Unirse al programa de early adopters de Chainlink
3. Contactar al equipo de Chainlink via el formulario de la pagina de ACE

### Roadmap de migracion sugerido

```
Fase 1 (Actual): MVP con mocks en Base Sepolia
  └── CCIDRegistry mock
  └── PolicyManager mock
  └── CRE real (o mock si no hay acceso)

Fase 2: Produccion con mocks en Base Mainnet
  └── Mismos mocks pero en mainnet
  └── CRE en produccion
  └── Banco real conectado

Fase 3: Migracion a ACE (cuando este disponible en Base)
  └── Reemplazar CCIDRegistry → CCID real
  └── Reemplazar PolicyManager → ACE Policy Manager
  └── Integrar vLEI para la entidad emisora
  └── Mantener CRE, MinterContract, RedeemContract sin cambios
```
