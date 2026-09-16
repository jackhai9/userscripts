/**
 * Model a native form that performs client-side validation before issuing any
 * exchange request. The real userscript still clicks the native button and
 * observes its DOM feedback; this host owns only the page's validation boundary.
 */
export function installNativeSubmitFeedbackHost({ ownerDocument = document, initialText = '', busy = false } = {}) {
  const entry = ownerDocument.querySelector('#trade-form .order-entry');
  if (!entry || typeof initialText !== 'string' || typeof busy !== 'boolean') {
    throw new Error('Native validation requires one order form and explicit feedback options');
  }
  const feedback = ownerDocument.createElement('div');
  feedback.setAttribute('role', 'alert');
  feedback.textContent = initialText;
  ownerDocument.body.append(feedback);
  const attempts = [];
  let disposed = false;
  const capture = event => {
    const button = event.target.closest('button');
    if (!button || !entry.contains(button)) return;
    event.stopImmediatePropagation();
    const price = entry.querySelector('input[id^="limitPrice-"]');
    const quantity = entry.querySelector('input[id^="unitAmount-"]');
    if (!price || !quantity) throw new Error('Native validation requires both submitted fields');
    attempts.push({ action: button.textContent.trim(), price: price.value, quantity: quantity.value });
    if (busy) button.setAttribute('data-loading', 'true');
  };
  entry.addEventListener('click', capture, true);
  return {
    snapshot() {
      return { attempts: attempts.map(attempt => ({ ...attempt })), text: feedback.textContent };
    },
    publish(text, { replaceMarkup = false } = {}) {
      if (disposed || attempts.length === 0 || typeof text !== 'string') {
        throw new Error('Native validation needs an active submitted attempt before feedback');
      }
      if (replaceMarkup) {
        const strong = ownerDocument.createElement('strong');
        strong.textContent = text;
        feedback.replaceChildren(strong);
      } else {
        feedback.textContent = text;
      }
    },
    dispose() {
      if (disposed) throw new Error('Native validation was already disposed');
      disposed = true;
      entry.removeEventListener('click', capture, true);
      entry.querySelectorAll('button[data-loading="true"]').forEach(button => button.removeAttribute('data-loading'));
      feedback.remove();
    },
  };
}

/** Model a controlled native input rejecting each proposed value at its input boundary. */
export function installNativeInputRollbackHost({ ownerDocument = document, selector, rollbackValue }) {
  const inputs = ownerDocument.querySelectorAll(selector);
  if (inputs.length !== 1 || typeof rollbackValue !== 'string') {
    throw new Error('Native input rollback requires one field and its explicit committed value');
  }
  const input = inputs[0];
  const proposed = [];
  const reject = () => {
    proposed.push(input.value);
    input.value = rollbackValue;
  };
  input.addEventListener('input', reject);
  return {
    snapshot: () => ({ proposed: [...proposed], current: input.value }),
    dispose: () => input.removeEventListener('input', reject),
  };
}
