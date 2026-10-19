import type { Metadata } from 'next';
import { AuthForm } from '@/components/AuthForm';

export const metadata: Metadata = { title: 'Create account — TerraGo' };

export default function RegisterPage() {
  return <AuthForm mode="register" />;
}
