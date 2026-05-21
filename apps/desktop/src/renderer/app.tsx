import React from "react";
import { createRoot } from "react-dom/client";

const App: React.FC = () => {
  return <div>Yomi</div>;
};

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
