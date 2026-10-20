# Checkin

Aplicación SAPUI5 independiente para que el personal de Mitsubishi registre su jornada desde SAP BTP.

## Incluido

- Entrada (`P10`), inicio de comida (`P15`), fin de comida (`P25`) y salida (`P20`).
- Secuencia controlada de acciones; no permite elegir un evento fuera de orden.
- Confirmación antes de cada marcaje.
- Geolocalización solicitada únicamente al marcar; no hay rastreo continuo.
- Consulta del empleado en `EmployeeSet` por número de nómina o correo.
- Registro real de marcajes en `AttendanceRecordSet`, incluyendo token CSRF.
- Consulta y agrupación del historial diario desde `AttendanceHistorySet`.
- Diseño adaptable a teléfono, tableta y escritorio.
- Ruta OData preparada para la destination BTP `Control_asistenci`.

## Ejecutar localmente

```bash
npm install
npm start
```

`npm start` utiliza el proxy de SAP Business Application Studio y la destination `Control_asistenci`. La opción **Preview Application** también usa esa destination mediante `ui5.yaml`; reinicie la vista previa después de cambiar cualquier archivo YAML.

El navegador debe permitir ubicación para realizar un marcaje. La pantalla ya no contiene registros ni datos de colaborador simulados; si SAP no está disponible, muestra el error de conexión sin inventar información.

## Conexión productiva

La identidad temporal se encuentra en `webapp/model/IdentityService.js` con el número `00004281`. Cuando se conecte el login, se debe llamar `setAuthenticatedIdentity` con el correo o número de nómina proporcionado por BTP y desactivar así el modo de prueba.

El servicio usa `P10`, `P15`, `P25` y `P20` para entrada, inicio de comida, fin de comida y salida.

La arquitectura, el contrato inicial y la lista de configuración se encuentran en [`docs/INTEGRACION_BTP_SAP.md`](docs/INTEGRACION_BTP_SAP.md).
