export type ServerSentEvent = {
  event: string;
  data: string;
};

const DEFAULT_EVENT_NAME = "message";

// Hand-rolled rather than EventSource: that is browser-only, GET-only, and
// cannot send the server secret. Follows the WHATWG dispatch rules: an event
// ends at a blank line, `data:` lines join with "\n", and lines starting with
// `:` are comments (ziza sends `: keepalive` every 15 s of silence).
export async function* readServerSentEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ServerSentEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let unparsedText = "";
  let eventName = DEFAULT_EVENT_NAME;
  let dataLines: string[] = [];

  const takeEvent = (): ServerSentEvent | null => {
    const completedEvent =
      dataLines.length > 0
        ? { event: eventName, data: dataLines.join("\n") }
        : null;
    eventName = DEFAULT_EVENT_NAME;
    dataLines = [];
    return completedEvent;
  };

  const readField = (line: string): ServerSentEvent | null => {
    if (line === "") {
      return takeEvent();
    }
    if (line.startsWith(":")) {
      return null;
    }
    const colonIndex = line.indexOf(":");
    const fieldName = colonIndex === -1 ? line : line.slice(0, colonIndex);
    let fieldValue = colonIndex === -1 ? "" : line.slice(colonIndex + 1);
    if (fieldValue.startsWith(" ")) {
      fieldValue = fieldValue.slice(1);
    }
    if (fieldName === "event") {
      eventName = fieldValue || DEFAULT_EVENT_NAME;
    } else if (fieldName === "data") {
      dataLines.push(fieldValue);
    }
    return null;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      unparsedText += decoder.decode(value, { stream: true });
      // Not splitting on a lone "\r": a "\r\n" cut across two chunks would
      // read as two line ends, and the empty line between dispatches early.
      const lines = unparsedText.split(/\r?\n/);
      unparsedText = lines.pop() ?? "";
      for (const line of lines) {
        const completedEvent = readField(line);
        if (completedEvent) {
          yield completedEvent;
        }
      }
    }

    unparsedText += decoder.decode();
    if (unparsedText !== "") {
      readField(unparsedText);
    }
    // A stream that closes without the final blank line still delivered its
    // last event; dropping it would lose `done` or `suggestions`.
    const trailingEvent = takeEvent();
    if (trailingEvent) {
      yield trailingEvent;
    }
  } finally {
    reader.releaseLock();
  }
}
