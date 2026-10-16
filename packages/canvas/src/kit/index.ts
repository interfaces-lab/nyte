import { Button } from "@nyte-ai/ui/button";
import { Checkbox } from "@nyte-ai/ui/checkbox";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { Kbd } from "@nyte-ai/ui/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@nyte-ai/ui/select";
import { Slider } from "@nyte-ai/ui/slider";
import { Spinner } from "@nyte-ai/ui/spinner";
import { Switch } from "@nyte-ai/ui/switch";
import { Tabs } from "@nyte-ai/ui/tabs";
import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import { BarChart, LineChart, PieChart } from "./charts.tsx";
import { Spark, StackedBars } from "./compact.tsx";
import { Badge, Callout, Card, Meter, Stat, Table } from "./data.tsx";
import { Divider, Grid, Stack } from "./layout.tsx";
import { useColorScheme } from "./scheme.ts";
import { Code, Heading, Text } from "./text.tsx";

export const kit = {
  Stack,
  Grid,
  Divider,
  Heading,
  Text,
  Code,
  Stat,
  Badge,
  Meter,
  Table,
  Callout,
  Card,
  StackedBars,
  Sparkline: Spark,
  LineChart,
  BarChart,
  PieChart,
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
