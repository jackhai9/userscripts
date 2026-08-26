import { generateCoveringArray } from '../helpers/covering-array.js';
import {
  ORDER_SETS,
  POSITION_SETS,
  createCancelScenario,
} from './cancel-current-symbol.js';

export const CANCEL_MATRIX_AXES = Object.freeze({
  positionSet: ['none', 'current', 'other', 'both'],
  orderSet: ['none', 'current', 'other', 'both'],
  accountTab: ['positions', 'openOrders', 'history'],
  openOrdersSubTab: ['basic', 'conditional'],
  hideOtherSymbols: [false, true],
  showOrders: [false, true],
  dialogOutcome: ['cancel', 'confirm'],
  mutationDelayMs: [0, 40],
});

const vectors = generateCoveringArray({ axes: CANCEL_MATRIX_AXES, strength: 2 });

export const CANCEL_COVERING_SCENARIOS = Object.freeze(vectors.map((vector, index) => ({
  id: `pairwise-${String(index + 1).padStart(2, '0')}`,
  vector,
  scenario: createCancelScenario({
    name: `cancel-${String(index + 1).padStart(2, '0')}`,
    matrix: {
      id: `pairwise-${String(index + 1).padStart(2, '0')}`,
      strength: 2,
      vector,
    },
    positions: POSITION_SETS[vector.positionSet],
    orders: ORDER_SETS[vector.orderSet],
    ui: {
      accountTab: vector.accountTab,
      openOrdersSubTab: vector.openOrdersSubTab,
      hideOtherSymbols: vector.hideOtherSymbols,
      showOrders: vector.showOrders,
    },
    host: { mutationDelayMs: vector.mutationDelayMs },
  }),
})));
