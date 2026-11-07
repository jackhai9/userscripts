const HOST_ROOT = 3;
const PLACEMENT_OR_HYDRATING = 2 | 4096;

function nearestMounted(fiber) {
  let node = fiber;
  let nearest = fiber;
  while (node) {
    if (!fiber.alternate && (node.flags & PLACEMENT_OR_HYDRATING)) nearest = node.return;
    if (!node.return) return node.tag === HOST_ROOT ? nearest : null;
    node = node.return;
  }
  return null;
}

/**
 * React 18.2's findCurrentFiberUsingSlowPath resolves shared bailout children as
 * well as alternating trees. DOM event props and the attached fiber alone can
 * remain on an earlier commit. This adapter follows only ancestors and sibling
 * sets, never Binance component names or the application's entire fiber tree.
 * Unmounted or unprovable ownership is an expected unavailable observation.
 */
export function findCurrentReactFiber(fiber) {
  if (!fiber) return null;
  const alternate = fiber.alternate;
  if (!alternate) return nearestMounted(fiber) === fiber ? fiber : null;
  let a = fiber;
  let b = alternate;
  while (a.return) {
    const parentA = a.return;
    const parentB = parentA.alternate;
    if (!parentB) {
      if (!parentA.return) break;
      a = b = parentA.return;
      continue;
    }
    if (parentA.child === parentB.child) {
      for (let child = parentA.child; child; child = child.sibling) {
        if (child === a || child === b) {
          if (nearestMounted(parentA) !== parentA) return null;
          return child === a ? fiber : alternate;
        }
      }
      return null;
    }
    if (a.return !== b.return) {
      a = parentA;
      b = parentB;
    } else {
      let found = false;
      for (const parent of [parentA, parentB]) {
        for (let child = parent.child; child; child = child.sibling) {
          if (child !== a && child !== b) continue;
          const other = parent === parentA ? parentB : parentA;
          [a, b] = child === a ? [parent, other] : [other, parent];
          found = true;
          break;
        }
        if (found) break;
      }
      if (!found) return null;
    }
    if (a.alternate !== b) return null;
  }
  if (a.tag !== HOST_ROOT) return null;
  if (a.stateNode.current === a) return fiber;
  return a.stateNode.current === b ? alternate : null;
}

export function readCurrentHostFiber(host) {
  if (!host.isConnected) return null;
  const keys = Object.keys(host).filter(key => key.startsWith('__reactFiber$'));
  if (keys.length !== 1) return null;
  const current = findCurrentReactFiber(host[keys[0]]);
  return current?.tag === 5 && current.stateNode === host ? current : null;
}
