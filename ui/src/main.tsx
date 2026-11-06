import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
if (window.lab) {
  createRoot(document.getElementById("root")!).render(<App />);
} else {
  document.getElementById("root")!.innerHTML =
    '<main style="padding:32px">请通过 NeuralFrame 桌面程序打开。此页面需要本机游戏与组件接口。</main>';
}
