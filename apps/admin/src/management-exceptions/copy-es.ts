import type { ExceptionsCopy } from "./copy-en";
export const exceptiones: ExceptionsCopy = {
  title: "Pendientes",
  intro: "Revisa los procesos interrumpidos y sigue el próximo paso seguro.",
  category: "Tipo",
  all: "Todos los tipos",
  webhook: "Eventos de pago",
  deadLetter: "Tareas fallidas",
  payment: "Pagos sin confirmar",
  notification: "Notificaciones fallidas",
  status: "Estado",
  open: "Requieren atención",
  allStates: "Todos los estados",
  filter: "Aplicar filtros",
  refresh: "Actualizar",
  back: "Volver a la lista",
  loading: "Cargando…",
  empty: "No hay elementos coincidentes.",
  previous: "Anterior",
  next: "Siguiente",
  view: "Ver",
  order: "Pedido",
  attempts: "Intentos",
  updated: "Actualización",
  nextStep: "Próximo paso",
  history: "Operaciones recientes",
  noHistory: "No hay operaciones registradas.",
  reason: "Motivo",
  chooseReason: "Selecciona un motivo",
  retryRepair: "Reintentar tras reparar",
  verifyStatus: "Verificar estado del proveedor",
  retryNotificationReason: "Reintentar una notificación fallida",
  reviewReason: "Revisión del operador",
  confirm: "He revisado este elemento y confirmo la siguiente operación.",
  submit: "Confirmar operación",
  replay: "Reprocesar evento verificado",
  retryDeadLetter: "Reintentar la tarea original",
  reconcile: "Consultar al proveedor de pago original",
  retryNotification: "Reintentar notificación fallida",
  replayHint:
    "Procesa de nuevo el evento verificado guardado. Se mantiene la deduplicación de pagos, reembolsos, entregas y notificaciones.",
  deadLetterHint: "Ejecuta la tarea con el evento y el consumidor originales.",
  reconcileHint:
    "Consulta el estado al proveedor original. No crea otro cobro.",
  notificationHint:
    "Solicita un reintento controlado. El servidor verifica el historial de entrega y las condiciones.",
  readOnly:
    "Tienes acceso de lectura. Solicita la acción a una persona autorizada.",
  inProgress:
    "El procesamiento está en curso. Actualiza para ver el resultado.",
  complete: "Este elemento está completo. No se requiere otra acción.",
  manualReview: "Este elemento requiere investigación antes de continuar.",
  unsupported: "Este tipo de tarea requiere revisión técnica.",
  notificationUncertain:
    "La entrega es incierta. Verifica el resultado antes de reenviar.",
  notificationExpired:
    "El plazo de reintento ha vencido. Revisa el historial con soporte.",
  notificationSuperseded:
    "Existe una notificación posterior. Revisa la más reciente.",
  notRetryable:
    "El estado actual no admite reintentos. Actualiza o solicita una revisión.",
  inconsistent:
    "Los registros de origen no coinciden. Solicita una revisión técnica.",
  pending: "Pendiente",
  processing: "En proceso",
  failed: "Fallido",
  unknown: "Sin confirmar",
  succeeded: "Completado",
  review: "Requiere revisión",
  expired: "Vencido",
  requested: "Solicitado",
  error: "No se pudo cargar la información. Vuelve a actualizar.",
  forbidden: "Tus permisos han cambiado. Actualiza para comprobarlos.",
  conflict:
    "El elemento cambió. Actualiza y revísalo antes de enviarlo otra vez.",
  uncertain:
    "El resultado no está confirmado. Recupera la solicitud original antes de iniciar otra acción.",
  storageUnavailable:
    "El almacenamiento de recuperación no está disponible. Restaura el almacenamiento del navegador y recarga.",
  recover: "Recuperar solicitud original",
  queued: "Solicitud registrada. Actualiza para ver el progreso.",
};
