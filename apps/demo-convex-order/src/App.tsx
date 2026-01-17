import { OrderList } from "@/components/OrderList";

function App() {
  return (
    <div className="min-h-screen bg-gray-900 py-8">
      <div className="max-w-2xl mx-auto px-4">
        <header className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-white mb-2">Order Management</h1>
          <p className="text-gray-400">
            EffState v3 + Convex/Confect Demo
          </p>
          <p className="text-gray-500 text-sm mt-2">
            Real-time sync across tabs with optimistic updates
          </p>
        </header>

        <OrderList />

        <footer className="mt-8 text-center text-gray-500 text-sm">
          <p>
            State machine transitions run locally for optimistic UI,
            <br />
            then sync to Convex for persistence and real-time updates.
          </p>
        </footer>
      </div>
    </div>
  );
}

export default App;
