'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Eye, EyeOff } from 'lucide-react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ApiError, persistToken } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';

const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const schema = z
  .object({
    name: z
      .string()
      .refine((value) => value.trim().replace(/\s+/g, ' ').length >= 2, 'Enter your full name')
      .refine(
        (value) => value.trim().replace(/\s+/g, ' ').length <= 160,
        'Name must be 160 characters or fewer',
      ),
    email: z
      .string()
      .max(320, 'Email must be 320 characters or fewer')
      .regex(emailPattern, 'Enter a valid email address'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(128, 'Password must be 128 characters or fewer'),
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type Form = z.infer<typeof schema>;

export default function SignupPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<{ message: string; duplicate: boolean } | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Form>({ resolver: zodResolver(schema), mode: 'onSubmit' });

  const submit = handleSubmit(async ({ name, email, password }) => {
    setBusy(true);
    setServerError(null);
    try {
      const response = await endpoints.register({
        name: name.trim().replace(/\s+/g, ' '),
        email: email.trim(),
        password,
      });
      persistToken(response.access_token);
      window.location.assign('/dashboard');
    } catch (error) {
      const duplicate = error instanceof ApiError && error.code === 'duplicate';
      setServerError({
        message: error instanceof Error ? error.message : 'Unable to create your account. Please try again.',
        duplicate,
      });
    } finally {
      setBusy(false);
    }
  });

  return (
    <main className="signup-layout">
      <section className="card signup-card" aria-labelledby="signup-title">
        <Link href="/" className="brand signin-brand" aria-label="TANTARA home">
          <img className="brandmark" src="/brand/t-mark.svg" alt="" />
          <span className="brandword">TANTARA</span>
        </Link>
        <h1 className="signup-heading" id="signup-title">
          Create your workspace
        </h1>
        <p className="signup-intro">Start organising your arbitration practice in your own workspace.</p>

        <form onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="signup-name">Full name</label>
            <input
              id="signup-name"
              autoComplete="name"
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? 'signup-name-error' : undefined}
              {...register('name')}
            />
            {errors.name && (
              <small className="signup-error" id="signup-name-error">
                {errors.name.message}
              </small>
            )}
          </div>
          <div className="field">
            <label htmlFor="signup-email">Email address</label>
            <input
              id="signup-email"
              type="email"
              autoComplete="email"
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? 'signup-email-error' : undefined}
              {...register('email')}
            />
            {errors.email && (
              <small className="signup-error" id="signup-email-error">
                {errors.email.message}
              </small>
            )}
          </div>
          <div className="field">
            <label htmlFor="signup-password">Password</label>
            <div className="password-field">
              <input
                id="signup-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                aria-invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? 'signup-password-error' : undefined}
                {...register('password')}
              />
              <button
                type="button"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
            {errors.password && (
              <small className="signup-error" id="signup-password-error">
                {errors.password.message}
              </small>
            )}
          </div>
          <div className="field">
            <label htmlFor="signup-confirm-password">Confirm password</label>
            <div className="password-field">
              <input
                id="signup-confirm-password"
                type={showConfirmation ? 'text' : 'password'}
                autoComplete="new-password"
                aria-invalid={Boolean(errors.confirmPassword)}
                aria-describedby={errors.confirmPassword ? 'signup-confirm-password-error' : undefined}
                {...register('confirmPassword')}
              />
              <button
                type="button"
                aria-label={showConfirmation ? 'Hide confirmation' : 'Show confirmation'}
                onClick={() => setShowConfirmation(!showConfirmation)}
              >
                {showConfirmation ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
            {errors.confirmPassword && (
              <small className="signup-error" id="signup-confirm-password-error">
                {errors.confirmPassword.message}
              </small>
            )}
          </div>
          {serverError && (
            <div className="signup-server-error" role="alert">
              {serverError.message}
              {serverError.duplicate && <Link href="/signin">Sign in instead</Link>}
            </div>
          )}
          <button className="primary" style={{ width: '100%', marginTop: 8, minHeight: 46 }} disabled={busy}>
            {busy ? 'Creating account…' : 'Create account'} <ArrowRight size={16} aria-hidden="true" />
          </button>
        </form>
        <p className="signup-footer-link">
          Already have an account? <Link href="/signin">Sign in</Link>
        </p>
        <p className="signup-disclaimer">
          For legal research assistance only. Verify all authorities and advice against primary sources.
        </p>
      </section>
    </main>
  );
}
