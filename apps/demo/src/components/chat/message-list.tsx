import { Message } from "@/types/message";
import { MessageBubble } from "./message-bubble";

type Props = {
  messages: readonly Message[];
  setElementRef: (id: Message["id"], element: HTMLElement | null) => void;
};

export const MessageList = ({ messages, setElementRef }: Props) => {
  return (
    <div className="flex flex-col gap-4 p-4">
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          ref={(el) => setElementRef(message.id, el)}
        />
      ))}
    </div>
  );
};
