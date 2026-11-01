export interface WritableLike {
  write(chunk: string): unknown;
  isTTY?: boolean | undefined;
  columns?: number | undefined;
}

export interface StreamSources {
  stdout: WritableLike;
  stderr: WritableLike;
  stdin: { isTTY?: boolean | undefined } & Partial<Readable>;
  env: Record<string, string | undefined>;
}

export interface IO {
  out: { write(s: string): void; isTTY: boolean; columns: number };
  err: { write(s: string): void; isTTY: boolean };
  /** Colour is allowed only on a TTY, and never when NO_COLOR is set. */
  colorEnabled: boolean;
  /** Prompts and spinners are allowed only when a person is at the terminal. */
  interactive: boolean;
  /** Reads a secret only from an interactive terminal and does not echo it. */
  readSecret(prompt: string): Promise<string>;
}

export function createStreams(src: StreamSources): IO {
  const outTTY = src.stdout.isTTY === true;
  const errTTY = src.stderr.isTTY === true;
  const noColor = (src.env["NO_COLOR"] ?? "") !== "";

  return {
    out: {
      write: (s) => void src.stdout.write(s),
      isTTY: outTTY,
      columns: src.stdout.columns ?? 80,
    },
    err: {
      write: (s) => void src.stderr.write(s),
      isTTY: errTTY,
    },
    colorEnabled: outTTY && !noColor,
    interactive: outTTY && src.stdin.isTTY === true,
    async readSecret(prompt) {
      if (src.stdin.isTTY !== true || typeof src.stdin.on !== "function") {
        throw new CliError({
          code: "USAGE",
          message: "A password can only be read from an interactive terminal.",
          hint: "Run the command in a terminal; passwords are never accepted as command-line flags.",
        });
      }
      src.stderr.write(prompt);
      const muted = new Writable({
        write(_chunk, _encoding, done) {
          done();
        },
      });
      const reader = createInterface({
        input: src.stdin as Readable,
        output: muted,
        terminal: true,
      });
      try {
        return await reader.question("");
      } finally {
        reader.close();
        src.stderr.write("\n");
      }
    },
  };
}
import { createInterface } from "node:readline/promises";
import { Writable, type Readable } from "node:stream";
import { CliError } from "../errors/cli-error.js";
