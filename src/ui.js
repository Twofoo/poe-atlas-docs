// Общие мелочи интерфейса.

// Где была нажата кнопка мыши (последний mousedown в окне).
let lastMouseDown = null;
if (typeof document !== 'undefined') {
  document.addEventListener('mousedown', (e) => { lastMouseDown = e.target; }, true);
}

/**
 * Обработчик фона модального окна: закрывает окно только если кнопку мыши
 * и нажали, и отпустили на самом фоне. Выделение текста, начатое внутри окна
 * и законченное снаружи, окно больше не закрывает.
 */
export function backdrop(onClose) {
  return {
    onClick: (e) => {
      if (e.target === e.currentTarget && lastMouseDown === e.currentTarget) onClose();
    },
  };
}
