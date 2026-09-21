/** A mounted private panel owns this value; closing invalidates in-flight results. */
export function createPrivateView<T>() {
  let epoch = 0;
  let value: T | null = null;
  return {
    begin() {
      value = null;
      return ++epoch;
    },
    accept(request: number, next: T) {
      if (request !== epoch) return false;
      value = next;
      return true;
    },
    read() {
      return value;
    },
    clear() {
      ++epoch;
      value = null;
    },
  };
}
