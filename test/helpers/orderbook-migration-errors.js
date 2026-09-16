/** Records the real operation's failure so execution and error assertions stay separate. */
export function captureThrownError(operation) {
  try {
    operation();
    return null;
  } catch (error) {
    return error;
  }
}
