import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { SettingsTabButton } from '../components/modals/SettingsModal';

const meta = {
  title: 'Design System/SettingsTabButton',
  component: SettingsTabButton,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  args: {
    active: false,
    onClick: () => {},
    icon: <span>🎨</span>,
    label: 'Appearance',
  },
} satisfies Meta<typeof SettingsTabButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Active: Story = {
  args: { active: true, label: 'Appearance' },
};

export const Inactive: Story = {
  args: { active: false, label: 'Language' },
};
