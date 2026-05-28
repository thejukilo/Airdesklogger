import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export interface SignaturePadHandle {
  toDataURL: () => string;
  clear: () => void;
  isEmpty: () => boolean;
}

/**
 * A small canvas the signer draws on. The image is captured as a PNG data URL,
 * which is what FOCA 2.4.3 accepts as a handwritten signature. White background
 * so the exported image is not transparent.
 */
/**
 * Optional callback fired when the pad's empty/non-empty state flips - lets
 * a parent form enable/disable the submit button without polling.
 */
export interface SignaturePadProps {
  onChange?: (hasInk: boolean) => void;
}

export const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(function SignaturePad({ onChange }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1a1a1a";
  }, []);

  function pos(e: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    drawing.current = true;
    const ctx = canvasRef.current!.getContext("2d")!;
    const [x, y] = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    canvasRef.current!.setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const [x, y] = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!dirty.current) {
      dirty.current = true;
      onChange?.(true);
    }
  }
  function up() {
    drawing.current = false;
  }

  useImperativeHandle(ref, () => ({
    toDataURL: () => canvasRef.current!.toDataURL("image/png"),
    isEmpty: () => !dirty.current,
    clear: () => {
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "#1a1a1a";
      if (dirty.current) {
        dirty.current = false;
        onChange?.(false);
      }
    },
  }));

  return (
    <canvas
      ref={canvasRef}
      width={460}
      height={150}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerLeave={up}
      className="w-full touch-none rounded-md border bg-white"
      style={{ touchAction: "none" }}
    />
  );
});
