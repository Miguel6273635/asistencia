# Checkin

Aplicación SAPUI5 independiente para que el personal de Mitsubishi registre su jornada desde SAP BTP.

## Incluido

- Entrada (`P10`), inicio de comida (`P15`), fin de comida (`P25`) y salida (`P20`).
- Secuencia controlada de acciones; no permite elegir un evento fuera de orden.
- Confirmación antes de cada marcaje.
- Geolocalización solicitada únicamente al marcar; no hay rastreo continuo.
- Acceso temporal para consultar `EmployeeSet` por número de nómina o correo, sin un empleado fijo en el código.
- Registro real de marcajes en `AttendanceRecordSet`, incluyendo token CSRF.
- Consulta y agrupación del historial diario desde `AttendanceHistorySet`.
- Diseño adaptable a teléfono, tableta y escritorio.
- Ruta OData `/sap/opu/odata/sap/ZHMC_ATTENDANCE_MONITORING_SRV/` preparada para la destination BTP `Control_asistenci`.

## Ejecutar localmente

```bash
npm install
npm start
```

`npm start` utiliza directamente el servidor UI5 y, durante la vista previa, dirige el servicio a la URL pública configurada en `ui5-local.yaml`. Esto evita depender de que el Dev Space tenga acceso a la destination. El despliegue productivo continúa usando `Control_asistenci` mediante `xs-app.json`.

El navegador debe permitir ubicación para realizar un marcaje. La pantalla ya no contiene registros ni datos de colaborador simulados; si SAP no está disponible, muestra el error de conexión sin inventar información.

## Conexión productiva

La pantalla inicial permite escribir temporalmente la nómina o el correo. Una nómina corta se completa a 8 posiciones (`4281` se consulta como `00004281`). Cuando se conecte el login, se debe llamar `setAuthenticatedIdentity` con el correo o número de nómina proporcionado por BTP y retirar la pantalla temporal.

El servicio usa `P10`, `P15`, `P25` y `P20` para entrada, inicio de comida, fin de comida y salida.

La arquitectura, el contrato inicial y la lista de configuración se encuentran en [`docs/INTEGRACION_BTP_SAP.md`](docs/INTEGRACION_BTP_SAP.md).
