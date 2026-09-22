import type { PaymentCopy } from "./copy-en";
export const paymentSpanish = {
  before: "Antes",
  after: "Después",
  notRecorded: "Sin registro",

  title: "Configuración de pagos",
  intro:
    "Gestiona los canales conectados. Los cambios se aplican a nuevos pagos tras publicar.",
  loading: "Cargando configuración…",
  refresh: "Actualizar",
  retry: "Reintentar",
  noAccess: "No tienes acceso a la configuración de pagos.",
  emptyAccounts:
    "No hay cuentas implementadas disponibles. Pide al administrador que conecte una.",
  legacy:
    "La configuración actual es anterior a este editor. Crea un borrador para gestionarla.",
  current: "Publicación actual",
  version: "Versión",
  edit: "Editar una copia",
  newDraft: "Crear borrador",
  save: "Guardar borrador",
  saved:
    "Borrador guardado. Revisa los textos para clientes antes de publicar.",
  draftHint:
    "Guardar crea una versión nueva. Los textos sin cambios de una versión publicada pueden conservar su aprobación; los nuevos o modificados requieren revisión independiente.",
  back: "Volver",
  channels: "Canales de pago",
  addChannel: "Añadir canal",
  account: "Cuenta conectada",
  enabled: "Habilitado para nuevos pagos",
  order: "Orden de visualización",
  rollout: "Porcentaje de tráfico (%)",
  health: "Avanzado: salud del canal",
  healthHint:
    "Usa la política implementada o completa todos los campos. Los fallos técnicos pueden pausar nuevos pagos.",
  failures: "Fallos antes de pausar",
  window: "Ventana de fallos (segundos)",
  openDuration: "Duración de pausa (segundos)",
  probeLease: "Tiempo límite de comprobación (segundos)",
  probeRetry: "Intervalo de comprobación (segundos)",
  text: "Textos para clientes",
  language: "Idioma",
  name: "Nombre del canal",
  hint: "Indicaciones de pago",
  source: "Original en inglés",
  missing: "Falta",
  draft: "Borrador",
  inReview: "Pendiente de revisión",
  approved: "Aprobado",
  stale: "Original modificado",
  submit: "Enviar a revisión",
  approve: "Aprobar este idioma",
  reviewHint:
    "Otra persona autorizada debe revisar cada idioma, incluido el inglés.",
  routes: "Reglas de disponibilidad",
  addRule: "Añadir regla",
  remove: "Eliminar",
  rule: "Regla",
  method: "Método de pago",
  countries: "Códigos de países",
  markets: "Mercados",
  currencies: "Códigos de moneda",
  codesHint:
    "Separa los valores con comas. Países y monedas deben ajustarse a la cuenta; el idioma no elige el mercado.",
  minimum: "Importe mínimo (unidad menor)",
  maximum: "Importe máximo (unidad menor)",
  amountHint:
    "Los límites se aplican a cada moneda indicada. Abajo se muestran los importes formateados.",
  devices: "Presentación de pago requerida",
  priority: "Prioridad (menor primero)",
  invalid:
    "Revisa los campos. Usa unidades monetarias menores enteras y porcentajes de 0 a 100.",
  checkPublish: "Comprobar cambios para publicar",
  checkRollback: "Comprobar restauración",
  changes: "Cambios respecto a la publicación actual",
  noChanges: "No se encontraron diferencias.",
  added: "Añadido",
  removed: "Eliminado",
  changed: "Modificado",
  validationFailed:
    "No se puede publicar. Resuelve los problemas y vuelve a comprobar.",
  ready: "Validación correcta. Confirma los cambios para publicar.",
  reason: "Motivo",
  reasonUpdate: "Actualización operativa",
  reasonRecovery: "Restaurar configuración conocida",
  confirm: "He revisado los cambios y confirmo esta acción.",
  publish: "Publicar configuración",
  rollback: "Restaurar esta versión",
  published:
    "Configuración publicada. Se aplicará a nuevos pagos al actualizarse los nodos.",
  publishHint:
    "Los pagos y reembolsos existentes conservan su cuenta original. Se audita cada publicación y restauración.",
  history: "Historial de versiones",
  view: "Abrir versión",
  wasPublished: "Publicado anteriormente",
  noHistory: "Aún no hay versiones gestionadas.",
  readOnly: "Acceso de solo lectura",
  error:
    "No se pudo confirmar la operación. Recupera la solicitud o actualiza la configuración.",
  conflict:
    "La versión actual cambió. Actualiza antes de preparar otro cambio.",
  selfReview:
    "El autor no puede aprobar su texto. Pide revisión a otra persona autorizada.",
  pending:
    "El resultado es incierto. Recupera la misma solicitud antes de otro cambio.",
  recover: "Recuperar esta solicitud",
  storageUnavailable:
    "El almacenamiento de recuperación no está disponible. Los cambios están deshabilitados.",
  reviewed: "Revisión registrada.",
  emptyRoutes: "Añade al menos una regla utilizable.",
  accountUnavailable:
    "Esta cuenta no está disponible para la configuración seleccionada.",
  adapterUnavailable:
    "El adaptador requerido no está implementado o no está disponible.",
  unsupportedMethod: "La cuenta no admite este método de pago.",
  invalidRoute: "Revisa el ámbito, los límites y la cuenta de esta regla.",
  translationMissing: "Completa el nombre y las indicaciones en este idioma.",
  translationUnapproved: "Este idioma necesita aprobación independiente.",
  translationStale:
    "Cambió el original inglés. Actualiza y revisa la traducción.",
  healthInvalid: "Completa los ajustes de salud dentro de sus límites.",
  notPublished:
    "Solo se puede restaurar una versión gestionada que ya se haya publicado.",
  redirect: "Redirigir al proveedor",
  iframe: "Marco alojado por el proveedor",
  component: "Componente del proveedor",
  qr: "Código QR",
  channelStatus: "Estado de conexión",
  available: "Disponible",
  unavailable: "No disponible",
  none: "Ninguno",
  unsaved: "Cambios sin guardar",
} satisfies PaymentCopy;
