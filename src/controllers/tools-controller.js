const ps = require("../services/ps");

// 这个控制器不需要像 app-controller 那样维护复杂的 state
// 它只需要绑定事件

function initToolsController() {
  const btnNeutralGray = document.getElementById("btnNeutralGray");
  const btnObserver = document.getElementById("btnObserver");
  const btnStamp = document.getElementById("btnStamp");

  // 绑定事件
  if (btnNeutralGray) {
    btnNeutralGray.addEventListener("click", async () => {
      try {
        await ps.createNeutralGrayLayer();
        // 如果你有 toast 系统，可以在这里调用 showToast("创建成功")
        console.log("中性灰图层已创建");
      } catch (e) {
        console.error("创建失败", e);
        // showToast("创建失败: " + e.message, "error");
      }
    });
  }

  if (btnObserver) {
    btnObserver.addEventListener("click", async () => {
      await ps.createObserverLayer();
    });
  }

  if (btnStamp) {
    btnStamp.addEventListener("click", async () => {
      await ps.stampVisibleLayers();
    });
  }
}

module.exports = { initToolsController };