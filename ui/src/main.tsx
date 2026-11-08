import { createRoot } from "react-dom/client";
import App from "./App";
import { t } from "./i18n";
import "./styles.css";
if (window.lab) {
  createRoot(document.getElementById("root")!).render(<App />);
} else {
  const explanation = document.createElement("main");
  explanation.style.padding = "32px";
  explanation.textContent = t("请通过 NeuralFrame 桌面程序打开。此页面需要本机游戏与组件接口。");
  document.getElementById("root")!.append(explanation);
}
