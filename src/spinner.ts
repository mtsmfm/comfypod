const FRAMES = ["|", "/", "-", "\\"];

export function createSpinner(initialMessage = "") {
  let tick = 0;
  let message = initialMessage;

  const interval = setInterval(() => {
    const frame = FRAMES[tick++ % FRAMES.length];
    process.stdout.write(`\r\x1b[K  ${frame} ${message}`);
  }, 100);

  return {
    update(msg: string) {
      message = msg;
    },
    stop(finalMessage: string) {
      clearInterval(interval);
      process.stdout.write(`\r\x1b[K  ${finalMessage}\n`);
    },
  };
}
