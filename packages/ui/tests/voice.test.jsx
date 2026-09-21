import React from 'react';
import { render, screen } from '@testing-library/react';
import VoicePanel from '../src/voice/VoicePanel';

test('renders listening state and transcript', () => {
  render(<VoicePanel state="listening" partials="hello" onStop={()=>{}} />);
  expect(screen.getByText(/Listening/)).toBeTruthy();
  expect(screen.getByText(/hello/)).toBeTruthy();
});
