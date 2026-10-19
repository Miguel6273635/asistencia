# Checkin

Aplicación SAPUI5 independiente para que el personal de Mitsubishi registre su jornada desde SAP BTP.

## Incluido

- Entrada (`P10`), inicio de comida (`P15`), fin de comida (`P25`) y salida (`P20`).
- Secuencia controlada de acciones; no permite elegir un evento fuera de orden.
- Confirmación antes de cada marcaje.
- Geolocalización solicitada únicamente al marcar; no hay rastreo continuo.
- Identificador único por solicitud para soportar idempotencia.
- Resumen de jornada y últimos registros con datos de prueba.
- Diseño adaptable a teléfono, tableta y escritorio.
- Ruta `/api/attendance/` preparada para un destino BTP llamado `AttendanceBackend`.

## Ejecutar localmente

```bash
npm install
npm start
```

El navegador debe permitir ubicación para probar un marcaje. En desarrollo local el servicio devuelve una respuesta simulada desde `webapp/model/AttendanceService.js`.

## Conexión productiva

Sustituir la respuesta simulada de `AttendanceService.mark` por un `POST` a `/api/attendance/events`. El backend deberá validar identidad, horario, estatus bloqueantes, secuencia, tolerancia, geocerca e idempotencia antes de registrar el evento SAP.

La respuesta no debe exponer errores técnicos de BAPI. Debe devolver un resultado funcional y el estado actualizado de la jornada.

La arquitectura, el contrato inicial y la lista de configuración se encuentran en [`docs/INTEGRACION_BTP_SAP.md`](docs/INTEGRACION_BTP_SAP.md).
