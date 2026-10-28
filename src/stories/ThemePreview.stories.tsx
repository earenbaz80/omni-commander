import type { Meta, StoryObj } from '@storybook/react-vite';
import { ThemePreview } from '../components/modals/SettingsModal';

const meta = {
  title: 'Design System/ThemePreview',
  component: ThemePreview,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  args: { themeId: 'classic_blue', lang: 'en' },
} satisfies Meta<typeof ThemePreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ClassicBlue: Story = { args: { themeId: 'classic_blue' } };
export const Windows11Dark: Story = { args: { themeId: 'windows11_dark' } };
export const DraculaRetro: Story = { args: { themeId: 'dracula_retro' } };
export const SolarizedDark: Story = { args: { themeId: 'solarized_dark' } };
