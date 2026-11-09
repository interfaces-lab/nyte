import { Button } from "@nyte-ai/ui/button";
import { Checkbox } from "@nyte-ai/ui/checkbox";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { Kbd } from "@nyte-ai/ui/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@nyte-ai/ui/select";
import { Slider } from "@nyte-ai/ui/slider";
import { Spinner } from "@nyte-ai/ui/spinner";
import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import { BarChart, LineChart, PieChart, useNivoTheme } from "./charts.tsx";
import { Spark, StackedBars } from "./compact.tsx";
import { BarList, Badge, Delta, DiffStat, KeyValue, Meter, Stat, Table } from "./data.tsx";
import { FileLink, Steps, Tabs, Tracker } from "./flow.tsx";
import { Divider, Grid, Pane, Panes, Stack } from "./layout.tsx";
import { useColorScheme } from "./scheme.ts";
import { Switch } from "./switch.tsx";
import { Callout, Card, Code, Section } from "./surface.tsx";
import { Heading, Text } from "./text.tsx";

export const kit = {
  Stack,
  Grid,
  Divider,
  Panes,
  Pane,
  Heading,
  Text,
  Code,
  FileLink,
  Stat,
  Delta,
  Badge,
  Meter,
  Table,
  KeyValue,
  DiffStat,
  BarList,
  Steps,
  Tracker,
  Callout,
  Card,
  Section,
  StackedBars,
  Sparkline: Spark,
  LineChart,
  BarChart,
  PieChart,
  useNivoTheme,
  Button,
  Tabs,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  ToggleGroup,
  Toggle,
  Switch,
  Checkbox,
  Slider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  Collapsible,
  Kbd,
  Spinner,
  useColorScheme,
};
