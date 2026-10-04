import { createRoot } from "react-dom/client";
import { StrictMode, useState } from "react";
import { AccountProvider } from "../../account/provider.tsx";

function App() {
  const [count, setCount] = useState(0);

  return (
    <button id="count" onClick={() => setCount(count + 1)}>
      {count}
    </button>
  );
}

createRoot(document.body).render(
  <StrictMode>
    <AccountProvider>
      <App />
    </AccountProvider>
  </StrictMode>,
);
