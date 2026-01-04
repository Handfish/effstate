// import { ChatContainer } from "./components/chat";
import { GarageDoor } from "@/components/garage-door/garage-door";

function App() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="h-screen w-full max-w-md">
        <GarageDoor />
        {/*  <ChatContainer />  */}
      </div>
    </div>
  );
}

export default App;
