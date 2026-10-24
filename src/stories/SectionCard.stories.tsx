import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { SectionCard } from '../components/modals/SettingsModal';

const meta = {
  title: 'Design System/SectionCard',
  component: SectionCard,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  args: {
    title: 'Appearance',
    children: <p>Content goes here</p>,
  },
} satisfies Meta<typeof SectionCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithContent: Story = {
  args: {
    title: 'Appearance',
    children: (
      <div className="space-y-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" defaultChecked />
          <span>Show toolbar</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" />
          <span>Show info bar</span>
        </label>
      </div>
    ),
  },
};
