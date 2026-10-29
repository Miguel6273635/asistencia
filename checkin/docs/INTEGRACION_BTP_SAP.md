# Integración BTP–SAP

## Arquitectura propuesta

1. El usuario se autentica mediante el proveedor de identidad configurado en BTP.
2. La aplicación obtiene el empleado SAP asociado a la identidad autenticada; nunca acepta un `PERNR` editable desde el navegador.
3. Al marcar, el navegador solicita ubicación y envía el registro a `AttendanceRecordSet`.
4. El servicio valida estatus, horario, secuencia de eventos, tolerancia, geocerca e idempotencia.
5. SAP registra `P10`, `P15`, `P25` o `P20` mediante el mecanismo aprobado y devuelve el estado consolidado de la jornada.

## OData configurado

- Destination BTP: `Control_asistenci`.
- Servicio: `/ZHMC_ATTENDANCE_MONITORING_SRV/` relativo a la URL base de la destination.
- Empleado: `EmployeeSet` filtrado por `PersonalNumber` o `Email`.
- Marcaje: `POST AttendanceRecordSet` con token CSRF.
- Historial: `AttendanceHistorySet` filtrado por `PersonalNumber` y `EnterDate`.

## Contrato de marcaje

Solicitud:

```json
{
  "PersonalNumber": "00004281",
  "RegisterType": "P10",
  "FullName": "MICHACA SANCHEZ JULIAN",
  "Email": "",
  "EnterDate": "2026-10-20",
  "EnterHour": "10:33:00",
  "Chanel": "SAP",
  "Device": "BTP-Web",
  "Latitude": "19.54021450",
  "Longitude": "-99.21548730",
  "GeoStatus": "",
  "IsLate": "",
  "Id_log": "",
  "StatusReq": "",
  "Message": ""
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
- Destination `Control_asistenci` apuntando al servicio SAP.
- Proveedor de identidad corporativo y atributo para resolver el empleado.
- Asignación de la aplicación en Work Zone o Launchpad Service.
- CORS, Cloud Connector y principal propagation cuando el backend sea on-premise.

Nunca se deben almacenar credenciales SAP, claves privadas ni tokens dentro de `webapp`.
