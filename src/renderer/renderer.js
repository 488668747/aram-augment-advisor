const statusElement = document.querySelector('#status');
const dataVersionElement = document.querySelector('#data-version');
const gamePatchElement = document.querySelector('#game-patch');
const dataSourceElement = document.querySelector('#data-source');

try {
  const active = await window.aramAugmentAdvisor.data.getActive();
  statusElement.textContent = '本地数据已加载';
  dataVersionElement.textContent = active.dataVersion;
  gamePatchElement.textContent = active.gamePatch;
  dataSourceElement.textContent = active.source?.region ?? '本地';
} catch (error) {
  statusElement.textContent = '本地数据读取失败';
  statusElement.classList.add('error');
  dataSourceElement.textContent = error instanceof Error ? error.message : String(error);
}
