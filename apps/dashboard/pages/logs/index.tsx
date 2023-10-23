import { CloseRounded } from '@mui/icons-material';
import InboxRoundedIcon from '@mui/icons-material/InboxRounded';
import Notifications from '@mui/icons-material/Notifications';
import {
  Button,
  IconButton,
  Option,
  Select,
  SelectProps,
  TabList,
  Tabs,
} from '@mui/joy';
import Alert from '@mui/joy/Alert';
import Box from '@mui/joy/Box';
import Chip from '@mui/joy/Chip';
import CircularProgress from '@mui/joy/CircularProgress';
import Divider from '@mui/joy/Divider';
import List from '@mui/joy/List';
import ListDivider from '@mui/joy/ListDivider';
import ListItem from '@mui/joy/ListItem';
import ListItemContent from '@mui/joy/ListItemContent';
import Sheet from '@mui/joy/Sheet';
import Skeleton from '@mui/joy/Skeleton';
import Stack from '@mui/joy/Stack';
import Tab, { tabClasses } from '@mui/joy/Tab';
import Typography from '@mui/joy/Typography';
import { useRouter } from 'next/router';
import { GetServerSidePropsContext } from 'next/types';
import { useSession } from 'next-auth/react';
import { ReactElement, useEffect, useMemo } from 'react';
import React from 'react';
import InfiniteScroll from 'react-infinite-scroller';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';

import ChatBox from '@app/components/ChatBox';
import { ConversationExport } from '@app/components/ConversationExport';
import ImproveAnswerModal from '@app/components/ImproveAnswerModal';
import Layout from '@app/components/Layout';
import { updateConversationStatus } from '@app/components/ResolveButton';
import { handleEvalAnswer } from '@app/hooks/useChat';
import useStateReducer from '@app/hooks/useStateReducer';

import relativeDate from '@chaindesk/lib/relative-date';
import { fetcher } from '@chaindesk/lib/swr-fetcher';
import { EvalSchema } from '@chaindesk/lib/types/dtos';
import { withAuth } from '@chaindesk/lib/withAuth';
import { ConversationStatus, MessageEval, Prisma } from '@chaindesk/prisma';

import { getAgents } from '../api/agents';
import { getLogs } from '../api/logs';
import { getConversation } from '../api/logs/[id]';

const LIMIT = 20;

interface SelectQueryParamFilterProps<T> {
  filterName: string;
}

function SelectQueryParamFilter<T extends {}>({
  filterName,
  ...otherProps
}: SelectQueryParamFilterProps<T> & SelectProps<T>) {
  const router = useRouter();
  const currentValue = router.query[filterName] as T;

  return (
    <Select
      value={currentValue}
      onChange={(_, value) => {
        if (value && typeof value === 'string') {
          router.query[filterName] = value;
          router.replace(router, undefined, {
            shallow: true,
          });
        }
      }}
      sx={{
        width: 175,
        height: 2,
        fontSize: 14,
        '@media (max-width: 900px)': {
          width: '100%',
        },
      }}
      {...(currentValue && {
        // display the button and remove select indicator
        // when user has selected a value
        endDecorator: (
          <IconButton
            size="sm"
            variant="plain"
            color="neutral"
            onMouseDown={(event) => {
              // don't open the popup when clicking on this button
              event.stopPropagation();
            }}
            onClick={() => {
              router.query[filterName] = '';
              router.replace(router, undefined, {
                shallow: true,
              });
            }}
          >
            <CloseRounded />
          </IconButton>
        ),
        indicator: null,
      })}
      {...otherProps}
    />
  );
}

enum TabEnum {
  All = 'all',
  Unresolved = 'unresolved',
  unread = 'unread',
  human_requested = 'human_requested',
}

const tabToParams = (tab: string): Record<string, unknown> => {
  switch (tab) {
    case TabEnum.human_requested:
      return {
        status: ConversationStatus.HUMAN_REQUESTED,
        unread: '',
      };
    case TabEnum.Unresolved:
      return {
        status: ConversationStatus.UNRESOLVED,
        unread: '',
      };

    case TabEnum.All:
      return {
        status: '',
        unread: '',
      };
    case TabEnum.unread:
      return {
        status: '',
        unread: true,
      };
    default:
      return {};
  }
};

export default function LogsPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const conversationId = router.query.conversationId as string;
  const hasFilterApplied =
    router.query.eval ||
    router.query.agentId ||
    router.query.tab !== TabEnum.All;
  const parentRef = React.useRef();
  const [state, setState] = useStateReducer({
    currentConversationId: undefined as string | undefined,
    hasReachedEnd: false,
    currentImproveAnswerID: undefined as string | undefined,
    loading: false,
  });
  const getConversationsQuery = useSWRInfinite<
    Prisma.PromiseReturnType<typeof getLogs>
  >((pageIndex, previousPageData) => {
    if (previousPageData && !previousPageData.length) {
      setState({
        hasReachedEnd: true,
      });
      return null; // reached the end
    }

    const cursor = previousPageData?.[previousPageData?.length - 1]
      ?.id as string;

    const params = new URLSearchParams({
      cursor: cursor || '',
      conversationId: conversationId || '',
      eval: (router.query.eval as string) || '',
      agentId: (router.query.agentId as string) || '',
      ...tabToParams(router.query.tab as string),
    });

    return `/api/logs?${params.toString()}`;
  }, fetcher);

  const getConversationQuery = useSWR<
    Prisma.PromiseReturnType<typeof getConversation>
  >(
    state.currentConversationId
      ? `/api/logs/${state.currentConversationId}`
      : null,
    fetcher
  );

  const getAgentsQuery = useSWR<Prisma.PromiseReturnType<typeof getAgents>>(
    '/api/agents',
    fetcher
  );

  const handleChangeTab = (tab: TabEnum) => {
    router.query.tab = tab;
    router.replace(router);
  };

  // Fetch single converstaion from query parameter (e.g: load converstaion from email notification)
  const getSingleConversationQuery = useSWR<
    Prisma.PromiseReturnType<typeof getConversation>
  >(conversationId ? `/api/logs/${conversationId}` : null, fetcher);

  const handleBannerAction = async ({
    conversationId,
    conversationStatus,
  }: {
    conversationId: string;
    conversationStatus: ConversationStatus;
  }) => {
    await updateConversationStatus(conversationId, conversationStatus);

    // sync data
    await Promise.all([
      getConversationQuery.mutate(),
      getConversationsQuery.mutate(),
    ]);

    // redirect to approriate tab
    if (conversationStatus === ConversationStatus.UNRESOLVED) {
      handleChangeTab(TabEnum.Unresolved);
    } else if (conversationStatus === ConversationStatus.RESOLVED) {
      handleChangeTab(TabEnum.All);
    }
  };
  const conversations = useMemo(() => {
    return [
      ...(getSingleConversationQuery?.data
        ? [getSingleConversationQuery?.data]
        : []),
      ...(getConversationsQuery?.data?.flat() || [])?.filter(
        // Filter out single conversation from list
        (each) => each.id !== getSingleConversationQuery?.data?.id
      ),
    ];
  }, [getConversationsQuery?.data, getSingleConversationQuery?.data]);

  useEffect(() => {
    if (getSingleConversationQuery?.data?.id) {
      setState({
        currentConversationId: getSingleConversationQuery?.data?.id,
      });
    }
  }, [getSingleConversationQuery?.data?.id]);

  React.useEffect(() => {
    if (typeof window !== 'undefined' && !router.query.tab) {
      handleChangeTab(TabEnum.All);
    }
  }, [router.query.tab]);

  if (!session?.organization) return null;

  if (
    !getConversationsQuery.isLoading &&
    conversations.length === 0 &&
    !hasFilterApplied
  ) {
    return (
      <Alert
        variant="outlined"
        sx={{
          textAlign: 'center',
          justifyContent: 'center',
          maxWidth: 'sm',
          mx: 'auto',
        }}
      >
        <Stack justifyContent={'center'} alignItems={'center'} gap={1}>
          <Typography level="h4" color="primary">
            <InboxRoundedIcon />
          </Typography>
          <Stack>
            <Typography level="body-md">No Data</Typography>
            <Typography level="body-sm">
              All conversations with your agents will be visible here
            </Typography>
          </Stack>
        </Stack>
      </Alert>
    );
  }

  function BannerActions() {
    switch (getConversationQuery?.data?.status) {
      case ConversationStatus.UNRESOLVED:
        return (
          <>
            {getConversationQuery.data?.lead?.email && (
              <Button
                onClick={async () => {
                  await navigator.clipboard.writeText(
                    getConversationQuery.data?.lead?.email as string
                  );
                }}
                sx={{ mx: 1 }}
              >
                {`Copy Visitor's Email`}
              </Button>
            )}
            <Button
              onClick={() => {
                handleBannerAction({
                  conversationId: state.currentConversationId!,
                  conversationStatus: ConversationStatus.RESOLVED,
                });
              }}
            >
              Resolve
            </Button>
          </>
        );
      case ConversationStatus.HUMAN_REQUESTED:
        return (
          <>
            {getConversationQuery.data?.lead?.email && (
              <Button
                sx={{
                  mx: 0.5,
                }}
                onClick={(e) => {
                  window.location.href = `mailto:${getConversationQuery.data?.lead?.email}`;
                  e.preventDefault();
                }}
              >
                Send Email
              </Button>
            )}

            <Button
              onClick={() => {
                handleBannerAction({
                  conversationId: state.currentConversationId!,
                  conversationStatus: ConversationStatus.RESOLVED,
                });
              }}
            >
              Resolve
            </Button>
          </>
        );
      case ConversationStatus.RESOLVED:
        return (
          <>
            {getConversationQuery.data?.lead?.email && (
              <Button
                onClick={async () => {
                  await navigator.clipboard.writeText(
                    getConversationQuery.data?.lead?.email as string
                  );
                }}
                sx={{ mx: 1 }}
              >
                {`Copy Visitor's Email`}
              </Button>
            )}
            <Button
              onClick={() => {
                handleBannerAction({
                  conversationId: state.currentConversationId!,
                  conversationStatus: ConversationStatus.UNRESOLVED,
                });
              }}
            >
              Un-Resolve
            </Button>
          </>
        );

      default:
        return null;
    }
  }

  return (
    <Stack gap={1} sx={{ height: 'calc(100vh - 175px)' }}>
      {/* <Alert
        variant="soft"
        color="neutral"
        startDecorator={<InfoRoundedIcon />}
      >
        View all Agents conversations across all channels. Evaluate and improve
        answers.
      </Alert> */}
      <Tabs
        aria-label="tabs"
        value={(router.query.tab as string) || TabEnum.All}
        size="lg"
        sx={{ bgcolor: 'transparent' }}
        defaultValue={1}
        onChange={(event, value) => {
          handleChangeTab(value as any);
        }}
      >
        <TabList
          size="sm"
          disableUnderline
          variant="plain"
          color="neutral"
          sx={{
            ml: 0,
            [`&& .${tabClasses.root}`]: {
              flex: 'initial',
              bgcolor: 'transparent',
              '&:hover': {
                bgcolor: 'transparent',
              },
              [`&.${tabClasses.selected}`]: {
                color: 'primary.plainColor',
                '&::after': {
                  bgcolor: 'primary.500',
                },
              },
            },
          }}
        >
          <Tab indicatorInset sx={{ pl: 0 }} value={TabEnum.human_requested}>
            Human Requested
          </Tab>
          <Tab indicatorInset value={TabEnum.unread}>
            Unread
          </Tab>

          <Tab indicatorInset value={TabEnum.Unresolved}>
            Unresolved
          </Tab>
          <Tab indicatorInset value={TabEnum.All}>
            All
          </Tab>
        </TabList>
      </Tabs>
      <Divider />
      <Stack
        width="100%"
        pl={1}
        gap={1}
        sx={{
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'space-between',
          '@media (max-width: 750px)': {
            flexDirection: 'column',
          },
        }}
      >
        <Stack
          sx={{
            flexDirection: 'row', // Default direction
            gap: 1,
            '@media (max-width: 750px)': {
              flexDirection: 'column', // Change direction for screens <= 600px
              height: 'auto',
            },
          }}
        >
          <SelectQueryParamFilter<EvalSchema>
            filterName="eval"
            placeholder="Filter by Evaluation"
          >
            <Option
              key={MessageEval.good}
              value={MessageEval.good}
              sx={{ fontSize: 14 }}
            >
              🟢 Good
            </Option>
            <Option
              key={MessageEval.bad}
              value={MessageEval.bad}
              sx={{ fontSize: 14 }}
            >
              🔴 Bad
            </Option>
          </SelectQueryParamFilter>

          <SelectQueryParamFilter<string>
            filterName="agentId"
            placeholder="Filter by Agent"
          >
            {getAgentsQuery.data?.map((each) => (
              <Option key={each.id} value={each.id}>
                {`🤖 ${each.name}`}
              </Option>
            ))}
          </SelectQueryParamFilter>
        </Stack>
        <Stack>
          <ConversationExport />
        </Stack>
      </Stack>

      <Sheet
        variant="outlined"
        sx={(theme) => ({
          height: '100%',
          borderRadius: 'sm',
          ml: 1,
        })}
      >
        <Stack direction={'row'} sx={{ height: '100%' }}>
          <Stack direction={'column'} sx={{ width: '40%' }}>
            <List
              // sx={{ '--ListItemDecorator-size': '56px' }}
              ref={parentRef as any}
              sx={{
                width: '100%',
                height: '100%',
                overflowY: 'auto',
                '--ListDivider-gap': '0px',
                borderRadius: 0,
              }}
              size="sm"
            >
              <InfiniteScroll
                useWindow={false}
                getScrollParent={() => parentRef.current as any}
                loadMore={() => {
                  if (
                    getConversationsQuery.isLoading ||
                    getConversationsQuery.isValidating
                  )
                    return;

                  getConversationsQuery.setSize(getConversationsQuery.size + 1);
                }}
                hasMore={!state.hasReachedEnd}
                loader={
                  Array(3)
                    .fill(0)
                    .map((each, idx) => (
                      <React.Fragment key={idx}>
                        <ListItem>
                          <Skeleton variant="text" />
                        </ListItem>

                        <ListDivider></ListDivider>
                      </React.Fragment>
                    )) as any
                }
                style={{ height: '100%' }}
              >
                {/* Add fragment to remove InfiniteScroll warning when empty conversations */}
                <React.Fragment />
                {conversations.length === 0 && (
                  <Box
                    sx={{
                      textAlign: 'center',
                      height: '100%',
                      my: '50%',
                    }}
                  >
                    No Conversations found
                  </Box>
                )}
                {conversations.map((each) => (
                  <React.Fragment key={each.id}>
                    <ListItem
                      sx={(theme) => ({
                        py: 1,
                        '&:hover': {
                          cursor: 'pointer',
                          backgroundColor: theme.palette.action.hover,
                          borderRadius: 0,
                        },
                        ...(state.currentConversationId === each.id && {
                          backgroundColor: theme.palette.action.hover,
                        }),
                      })}
                      onClick={() => {
                        setState({
                          currentConversationId: each.id,
                        });
                      }}
                    >
                      <ListItemContent>
                        <Stack>
                          <Stack
                            direction="row"
                            justifyContent={'space-between'}
                          >
                            <Typography>{each?.agent?.name}</Typography>

                            <Typography level="body-xs">
                              {relativeDate(each?.updatedAt)}
                            </Typography>
                          </Stack>
                          <Stack
                            direction="row"
                            justifyContent={'space-between'}
                            alignItems={'start'}
                            gap={1}
                          >
                            <Typography level="body-sm" noWrap>
                              {each?.messages?.[0]?.text}
                            </Typography>

                            {each?._count?.messages > 0 && (
                              <Chip variant="solid" color="danger" size="md">
                                {each?._count?.messages}
                              </Chip>
                            )}
                          </Stack>
                          <Stack
                            direction="row"
                            sx={{
                              mt: 1,
                            }}
                            gap={1}
                          >
                            <Chip size="sm" color="neutral" variant="outlined">
                              {'🤖 '}
                              {each?.agent?.name}
                            </Chip>
                            <Chip size="sm" color="neutral" variant="outlined">
                              {'🚀 '}
                              {each?.channel}
                            </Chip>
                          </Stack>
                        </Stack>
                      </ListItemContent>
                    </ListItem>
                    <ListDivider />
                  </React.Fragment>
                ))}
              </InfiniteScroll>

              {getConversationsQuery.isLoading && (
                <CircularProgress
                  size="sm"
                  sx={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    zIndex: 99,
                  }}
                />
              )}
            </List>
          </Stack>

          <Divider orientation="vertical" />
          <Box sx={{ width: '100%', overflow: 'hidden' }}>
            {getConversationQuery.data && (
              <Alert
                color="primary"
                variant="soft"
                sx={{ borderRadius: 0 }}
                startDecorator={<Notifications />}
                endDecorator={<BannerActions />}
              >
                {getConversationQuery?.data?.status ===
                  ConversationStatus.RESOLVED && (
                  <p> This Conversation Has Been Resolved. </p>
                )}
                {getConversationQuery?.data?.status ===
                  ConversationStatus.UNRESOLVED && (
                  <p> This Conversation Is Still Unresolved. </p>
                )}
                {getConversationQuery?.data?.status ===
                  ConversationStatus.HUMAN_REQUESTED && (
                  <p> Human Assistance Was Requested On This Conversation. </p>
                )}
              </Alert>
            )}

            <ChatBox
              messages={
                getConversationQuery?.data?.messages?.map((each) => ({
                  id: each.id,
                  from: each.from,
                  message: each.text,
                  createdAt: each.createdAt,
                  eval: each.eval,
                })) || []
              }
              onSubmit={async () => {}}
              readOnly={true}
              handleEvalAnswer={handleEvalAnswer}
              handleImprove={(message) => {
                setState({
                  currentImproveAnswerID: message?.id,
                });
              }}
              userImgUrl={session?.user?.image!}
            />
          </Box>
        </Stack>

        {state.currentImproveAnswerID && (
          <ImproveAnswerModal
            handleCloseModal={() => {
              setState({
                currentImproveAnswerID: '',
              });
            }}
            messageId={state.currentImproveAnswerID}
          />
        )}
      </Sheet>
    </Stack>
  );
}

LogsPage.getLayout = function getLayout(page: ReactElement) {
  return <Layout>{page}</Layout>;
};

export const getServerSideProps = withAuth(
  async (ctx: GetServerSidePropsContext) => {
    return {
      props: {},
    };
  }
);
