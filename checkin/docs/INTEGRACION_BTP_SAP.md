# Integración BTP–SAP

## Arquitectura propuesta

1. El usuario se autentica mediante el proveedor de identidad configurado en BTP.
2. La aplicación obtiene el empleado SAP asociado a la identidad autenticada; nunca acepta un `PERNR` editable desde el navegador.
3. Al marcar, el navegador solicita ubicación y envía una sola solicitud a `POST /api/attendance/events`.
4. El servicio valida estatus, horario, secuencia de eventos, tolerancia, geocerca e idempotencia.
5. SAP registra `P10`, `P15`, `P25` o `P20` mediante el mecanismo aprobado y devuelve el estado consolidado de la jornada.

## Contrato mínimo del servicio

Solicitud:

```json
{
  "requestId": "ATT-...",
  "action": "CHECK_IN",
  "eventCode": "P10",
  "deviceTimestamp": "2026-10-19T13:27:00.000Z",
  "latitude": 19.5401,
  "longitude": -99.1956,
  "accuracyMeters": 12
}
```

Respuesta funcional:

```json
{
  "success": true,
  "resultCode": "ATTENDANCE_REGISTERED",
  "message": "Entrada registrada correctamente",
  "registeredAt": "2026-10-19T07:27:00-06:00",
  "journey": {
    "status": "ACTIVE",
    "nextAction": "MEAL_START",
    "geoStatus": "INSIDE_ZONE"
  }
}
```

## Reglas que deben vivir en backend

- Identidad del usuario y correspondencia con `PERNR`.
- Ventana anticipada de entrada y tolerancia.
- Ciclo de retardos y bloqueo del cuarto intento.
- Estatus que bloquean o justifican una jornada.
- Secuencia `P10 → P15 → P25 → P20`.
- Aplicabilidad de comida por población.
- Geocerca y precisión mínima aceptable.
- Detección de solicitudes repetidas.
- Hora oficial del registro.

## Configuración necesaria en BTP

- Instancia XSUAA y colección de roles para `Colaborador`.
- HTML5 Application Repository.
- Destination `AttendanceBackend` apuntando al servicio SAP/API Management/CAP.
- Proveedor de identidad corporativo y atributo para resolver el empleado.
- Asignación de la aplicación en Work Zone o Launchpad Service.
- CORS, Cloud Connector y principal propagation cuando el backend sea on-premise.

Nunca se deben almacenar credenciales SAP, claves privadas ni tokens dentro de `webapp`.
