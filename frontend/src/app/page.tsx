import { redirect } from 'next/navigation';

export default function HomePage() {
  // Bounce to dashboard — the AuthGate inside will redirect to /login if no session.
  redirect('/dashboard');
}
