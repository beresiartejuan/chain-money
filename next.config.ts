import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev: el preview visual del agente usa 127.0.0.1 (para no chocar con la
  // cookie httpOnly de localhost); sin esto el HMR queda bloqueado por el
  // chequeo cross-origin de Next 16 (no afecta producción).
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
